import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth.js";
import { requireRole, checkPatientAccess } from "../middleware/rbac.js";
import { auditLog } from "../middleware/audit.js";
import { createError, ErrorCodes } from "../lib/errors.js";
import {
  CreatePatientSchema,
  UpdatePatientSchema,
  UpdatePatientConsentSchema,
  PatientListQuerySchema,
} from "../schemas/patient.schema.js";
import type { Variables } from "../types/context.js";
import { idempotent } from "../middleware/idempotency.js";
import { Prisma } from "@prisma/client";

const patients = new Hono<{ Variables: Variables }>();

patients.use("/*", requireAuth);

patients.post(
  "/",
  requireRole("admin", "provider", "billing_staff"),
  auditLog("patient.create", "patient"),
  zValidator("json", CreatePatientSchema),
  async (c) => {
    const data = c.req.valid("json");
    const db = c.get("db");

    try {
      const patient = await db.patient.create({
        data: {
          first_name: data.first_name,
          last_name: data.last_name,
          date_of_birth: new Date(data.date_of_birth),
          email: data.email,
          phone: data.phone,
          address: data.address ?? Prisma.JsonNull,
          assigned_provider_id: data.assigned_provider_id,
        },
      });

      return c.json(patient, 201);
    } catch (error: any) {
      if (error.code === "P2002") {
        throw createError(
          409,
          ErrorCodes.CONFLICT,
          "A patient with this email already exists",
        );
      }
      throw createError(
        500,
        ErrorCodes.INTERNAL_ERROR,
        "Failed to create patient",
      );
    }
  },
);

patients.get(
  "/",
  requireRole("admin", "provider", "billing_staff"),
  zValidator("query", PatientListQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const db = c.get("db");
    const user = c.get("user");

    const limit = parseInt(query.limit || "20");
    const cursor = query.cursor;

    const where: any = {
      deleted_at: null,
    };

    // Role-based filtering
    if (user.role === "provider") {
      where.assigned_provider_id = user.id;
    } else if (user.role === "billing_staff") {
      // PLANTED-BUG-#5: Consent propagation delay
      // This query doesn't use a consistent snapshot, so consent revocations
      // mid-pagination can cause inconsistent results across pages
      where.consent_data_sharing = true;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.assigned_provider_id) {
      where.assigned_provider_id = query.assigned_provider_id;
    }

    if (cursor) {
      where.id = { gt: cursor };
    }

    const items = await db.patient.findMany({
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

patients.get("/:id", auditLog("patient.view", "patient"), async (c) => {
  const id = c.req.param("id");
  if (!id) {
    throw createError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      "Patient ID is required",
    );
  }
  const db = c.get("db");
  const user = c.get("user");

  const patient = await db.patient.findFirst({
    where: { id, deleted_at: null },
  });

  if (!patient) {
    throw createError(404, ErrorCodes.NOT_FOUND, "Patient not found");
  }

  const hasAccess = await checkPatientAccess(c, id);

  if (!hasAccess) {
    // PLANTED-BUG-#1: Returns 404 instead of 403
    // This is inconsistent with the rest of the API and allows enumeration attacks
    throw createError(404, ErrorCodes.NOT_FOUND, "Patient not found");
  }

  return c.json(patient);
});

patients.patch(
  "/:id",
  auditLog("patient.update", "patient"),
  zValidator("json", UpdatePatientSchema),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user");

    const patient = await db.patient.findFirst({
      where: { id, deleted_at: null },
    });

    if (!patient) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Patient not found");
    }

    const hasAccess = await checkPatientAccess(c, id);
    if (!hasAccess) {
      throw createError(
        403,
        ErrorCodes.FORBIDDEN,
        "You do not have permission to update this patient",
      );
    }

    // PLANTED-BUG-#6: Field-level authorization gap
    // When role is patient, should return 403 for disallowed fields
    // Instead, we silently drop them
    let updateData: any = { ...data };

    if (user.role === "patient") {
      // Patient can only update: phone, address, email
      const allowedFields = ["phone", "address", "email"];
      updateData = Object.keys(updateData).reduce((acc, key) => {
        if (allowedFields.includes(key)) {
          acc[key] = updateData[key];
        }
        // PLANTED-BUG-#6: Silently drop disallowed fields instead of returning 403
        return acc;
      }, {} as any);
    }

    if (updateData.date_of_birth) {
      updateData.date_of_birth = new Date(updateData.date_of_birth);
    }

    const updated = await db.patient.update({
      where: { id },
      data: updateData,
    });

    return c.json(updated);
  },
);

patients.delete(
  "/:id",
  requireRole("admin"),
  auditLog("patient.delete", "patient"),
  async (c) => {
    const id = c.req.param("id");
    const db = c.get("db");

    const patient = await db.patient.findFirst({
      where: { id, deleted_at: null },
    });

    if (!patient) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Patient not found");
    }

    // Soft delete
    const deleted = await db.patient.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        status: "inactive",
      },
    });

    return c.json({ message: "Patient deleted successfully" });
  },
);

patients.patch(
  "/:id/consent",
  requireRole("admin", "patient"),
  auditLog("consent.update", "patient"),
  // PLANTED-BUG-#3: Idempotency header is silently ignored on this endpoint
  // The idempotent() middleware is commented out here
  // idempotent(),
  zValidator("json", UpdatePatientConsentSchema),
  async (c) => {
    const id = c.req.param("id");
    const { consent_data_sharing } = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user");

    const patient = await db.patient.findFirst({
      where: { id, deleted_at: null },
    });

    if (!patient) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Patient not found");
    }

    if (user.role === "patient" && user.linked_patient_id !== id) {
      throw createError(
        403,
        ErrorCodes.FORBIDDEN,
        "You can only update your own consent",
      );
    }

    const previousValue = patient.consent_data_sharing;

    const updated = await db.patient.update({
      where: { id },
      data: {
        consent_data_sharing,
        consent_updated_at: new Date(),
      },
    });

    // Store metadata for audit
    await db.auditLog.create({
      data: {
        actor_id: user.id,
        actor_role: user.role,
        action: "consent.update",
        resource_type: "patient",
        resource_id: id,
        patient_id: id,
        metadata: {
          previous_value: previousValue,
          new_value: consent_data_sharing,
        },
        ip_address: c.req.header("x-forwarded-for") || null,
      },
    });

    return c.json(updated);
  },
);

export default patients;
