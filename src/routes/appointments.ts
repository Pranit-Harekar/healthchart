import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { auditLog } from "../middleware/audit.js";
import { idempotent } from "../middleware/idempotency.js";
import { createError, ErrorCodes } from "../lib/errors.js";
import {
  CreateAppointmentSchema,
  AppointmentListQuerySchema,
  CancelAppointmentSchema,
} from "../schemas/appointment.schema.js";
import type { Variables } from "../types/context.js";

const appointments = new Hono<{ Variables: Variables }>();

appointments.use("/*", requireAuth);

appointments.post(
  "/",
  idempotent(),
  auditLog("appointment.create", "appointment"),
  zValidator("json", CreateAppointmentSchema),
  async (c) => {
    const data = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user");

    const startTime = new Date(data.start_time);
    const now = new Date();

    // Check if start_time is in the past
    if (startTime < now) {
      throw createError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        "Start time cannot be in the past",
      );
    }

    // PLANTED-BUG-#2: Race condition in double-booking check
    // This uses a check-then-insert pattern WITHOUT a database-level exclusion constraint
    // Two simultaneous requests can both pass the check and create overlapping appointments

    // Check for overlapping appointments (racy check)
    const overlapping = await db.appointment.findFirst({
      where: {
        provider_id: data.provider_id,
        status: { in: ["confirmed", "checked_in"] },
        OR: [
          {
            AND: [
              { start_time: { lte: startTime } },
              { end_time: { gt: startTime } },
            ],
          },
          {
            AND: [
              { start_time: { lt: new Date(data.end_time) } },
              { end_time: { gte: new Date(data.end_time) } },
            ],
          },
          {
            AND: [
              { start_time: { gte: startTime } },
              { end_time: { lte: new Date(data.end_time) } },
            ],
          },
        ],
      },
    });

    if (overlapping) {
      throw createError(
        409,
        ErrorCodes.CONFLICT,
        "Provider already has an appointment during this time",
      );
    }

    // Gap here allows race condition - another request can slip through before this insert

    // Determine initial status based on role
    let initialStatus = "requested";
    if (
      user.role === "admin" ||
      user.role === "provider" ||
      user.role === "billing_staff"
    ) {
      initialStatus = "confirmed";
    }

    const appointment = await db.appointment.create({
      data: {
        patient_id: data.patient_id,
        provider_id: data.provider_id,
        start_time: startTime,
        end_time: new Date(data.end_time),
        status: initialStatus as any,
        reason: data.reason,
        created_by: user.id,
      },
    });

    return c.json(appointment, 201);
  },
);

appointments.get(
  "/",
  zValidator("query", AppointmentListQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const db = c.get("db");
    const user = c.get("user");

    const limit = parseInt(query.limit || "20");
    const cursor = query.cursor;

    const where: any = {};

    // Role-based filtering
    if (user.role === "provider") {
      where.provider_id = user.id;
    } else if (user.role === "patient") {
      const linkedPatient = await db.patient.findUnique({
        where: { id: user.linked_patient_id! },
      });
      if (linkedPatient) {
        where.patient_id = linkedPatient.id;
      }
    }

    if (query.patient_id) {
      where.patient_id = query.patient_id;
    }

    if (query.provider_id) {
      where.provider_id = query.provider_id;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.start_date || query.end_date) {
      where.start_time = {};
      if (query.start_date) {
        where.start_time.gte = new Date(query.start_date);
      }
      if (query.end_date) {
        where.start_time.lte = new Date(query.end_date);
      }
    }

    if (cursor) {
      where.id = { gt: cursor };
    }

    const items = await db.appointment.findMany({
      where,
      take: limit + 1,
      orderBy: { id: "asc" },
    });

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;

    return c.json({
      data: resultItems,
      pagination: {
        next_cursor: hasMore ? resultItems[resultItems.length - 1].id : null,
        has_more: hasMore,
      },
    });
  },
);

appointments.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  const user = c.get("user");

  const appointment = await db.appointment.findUnique({
    where: { id },
  });

  if (!appointment) {
    throw createError(404, ErrorCodes.NOT_FOUND, "Appointment not found");
  }

  // Check access
  if (user.role === "provider" && appointment.provider_id !== user.id) {
    throw createError(
      403,
      ErrorCodes.FORBIDDEN,
      "You do not have access to this appointment",
    );
  }

  if (user.role === "patient") {
    const linkedPatient = await db.patient.findUnique({
      where: { id: user.linked_patient_id! },
    });
    if (!linkedPatient || appointment.patient_id !== linkedPatient.id) {
      throw createError(
        403,
        ErrorCodes.FORBIDDEN,
        "You do not have access to this appointment",
      );
    }
  }

  return c.json(appointment);
});

appointments.patch(
  "/:id/confirm",
  requireRole("admin", "provider", "billing_staff"),
  auditLog("appointment.confirm", "appointment"),
  async (c) => {
    const id = c.req.param("id");
    const db = c.get("db");

    const appointment = await db.appointment.findUnique({ where: { id } });

    if (!appointment) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Appointment not found");
    }

    if (appointment.status !== "requested") {
      throw createError(
        409,
        ErrorCodes.CONFLICT,
        `Cannot confirm appointment with status: ${appointment.status}`,
      );
    }

    const updated = await db.appointment.update({
      where: { id },
      data: { status: "confirmed" },
    });

    return c.json(updated);
  },
);

appointments.patch(
  "/:id/checkin",
  requireRole("admin", "provider", "billing_staff"),
  auditLog("appointment.checkin", "appointment"),
  async (c) => {
    const id = c.req.param("id");
    const db = c.get("db");

    const appointment = await db.appointment.findUnique({ where: { id } });

    if (!appointment) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Appointment not found");
    }

    if (appointment.status !== "confirmed") {
      throw createError(
        409,
        ErrorCodes.CONFLICT,
        `Cannot check in appointment with status: ${appointment.status}`,
      );
    }

    const updated = await db.appointment.update({
      where: { id },
      data: { status: "checked_in" },
    });

    return c.json(updated);
  },
);

appointments.patch(
  "/:id/complete",
  requireRole("admin", "provider"),
  auditLog("appointment.complete", "appointment"),
  async (c) => {
    const id = c.req.param("id");
    const db = c.get("db");

    const appointment = await db.appointment.findUnique({ where: { id } });

    if (!appointment) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Appointment not found");
    }

    if (appointment.status !== "checked_in") {
      throw createError(
        409,
        ErrorCodes.CONFLICT,
        `Cannot complete appointment with status: ${appointment.status}`,
      );
    }

    const updated = await db.appointment.update({
      where: { id },
      data: { status: "completed" },
    });

    return c.json(updated);
  },
);

appointments.patch(
  "/:id/cancel",
  auditLog("appointment.cancel", "appointment"),
  zValidator("json", CancelAppointmentSchema),
  async (c) => {
    const id = c.req.param("id");
    const { cancelled_reason } = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user");

    const appointment = await db.appointment.findUnique({ where: { id } });

    if (!appointment) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Appointment not found");
    }

    // Check access for patients
    if (user.role === "patient") {
      const linkedPatient = await db.patient.findUnique({
        where: { id: user.linked_patient_id! },
      });
      if (!linkedPatient || appointment.patient_id !== linkedPatient.id) {
        throw createError(
          403,
          ErrorCodes.FORBIDDEN,
          "You can only cancel your own appointments",
        );
      }
    }

    if (
      appointment.status === "completed" ||
      appointment.status === "cancelled"
    ) {
      throw createError(
        409,
        ErrorCodes.CONFLICT,
        `Cannot cancel appointment with status: ${appointment.status}`,
      );
    }

    const updated = await db.appointment.update({
      where: { id },
      data: {
        status: "cancelled",
        cancelled_reason,
      },
    });

    return c.json(updated);
  },
);

export default appointments;
