import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth.js";
import { requireRole, checkPatientAccess } from "../middleware/rbac.js";
import { auditLog } from "../middleware/audit.js";
import { createError, ErrorCodes } from "../lib/errors.js";
import {
  CreateRecordSchema,
  UpdateRecordSchema,
  RecordListQuerySchema,
} from "../schemas/record.schema.js";
import type { Variables } from "../types/context.js";

const records = new Hono<{ Variables: Variables }>();

records.use("/*", requireAuth);

const SENSITIVE_TYPES = ["mental_health", "substance_use"];

function isSensitiveType(recordType: string): boolean {
  return SENSITIVE_TYPES.includes(recordType);
}

records.post(
  "/patients/:patientId/records",
  requireRole("admin", "provider"),
  auditLog("record.create", "record"),
  zValidator("json", CreateRecordSchema),
  async (c) => {
    const patientId = c.req.param("patientId");
    const data = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user");

    const hasAccess = await checkPatientAccess(c, patientId);
    if (!hasAccess) {
      throw createError(
        403,
        ErrorCodes.FORBIDDEN,
        "You do not have access to this patient",
      );
    }

    const record = await db.record.create({
      data: {
        patient_id: patientId,
        appointment_id: data.appointment_id,
        author_id: user.id,
        record_type: data.record_type,
        title: data.title,
        body: data.body,
        status: "draft",
      },
    });

    return c.json(record, 201);
  },
);

records.get(
  "/patients/:patientId/records",
  zValidator("query", RecordListQuerySchema),
  async (c) => {
    const patientId = c.req.param("patientId");
    const query = c.req.valid("query");
    const db = c.get("db");
    const user = c.get("user");

    const hasAccess = await checkPatientAccess(c, patientId);
    if (!hasAccess) {
      throw createError(
        403,
        ErrorCodes.FORBIDDEN,
        "You do not have access to this patient",
      );
    }

    const limit = parseInt(query.limit || "20");
    const cursor = query.cursor;

    const where: any = {
      patient_id: patientId,
    };

    if (query.record_type) {
      where.record_type = query.record_type;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (cursor) {
      where.id = { gt: cursor };
    }

    // Patients can only see reviewed records
    if (user.role === "patient") {
      where.status = "reviewed";
    }

    let items = await db.record.findMany({
      where,
      take: limit + 1,
      orderBy: { id: "asc" },
    });

    // Filter sensitive types for providers without access
    if (user.role === "provider" && !user.sensitive_access) {
      items = items.filter((record) => !isSensitiveType(record.record_type));
    }

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

records.get("/:id", auditLog("record.view", "record"), async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  const user = c.get("user");

  const record = await db.record.findUnique({
    where: { id },
  });

  if (!record) {
    throw createError(404, ErrorCodes.NOT_FOUND, "Record not found");
  }

  const hasAccess = await checkPatientAccess(c, record.patient_id);
  if (!hasAccess) {
    throw createError(
      403,
      ErrorCodes.FORBIDDEN,
      "You do not have access to this record",
    );
  }

  // Patients can only see reviewed records
  if (user.role === "patient" && record.status !== "reviewed") {
    throw createError(
      403,
      ErrorCodes.FORBIDDEN,
      "You do not have access to this record",
    );
  }

  // Sensitive type access check for providers
  if (
    user.role === "provider" &&
    isSensitiveType(record.record_type) &&
    !user.sensitive_access
  ) {
    // PLANTED-BUG-#8: Leaking title in 403 error message
    throw createError(
      403,
      ErrorCodes.FORBIDDEN,
      `You do not have access to this sensitive record: "${record.title}"`,
    );
  }

  return c.json(record);
});

records.patch(
  "/:id/review",
  requireRole("admin", "provider"),
  auditLog("record.review", "record"),
  async (c) => {
    const id = c.req.param("id");
    const db = c.get("db");
    const user = c.get("user");

    const record = await db.record.findUnique({
      where: { id },
    });

    if (!record) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Record not found");
    }

    const hasAccess = await checkPatientAccess(c, record.patient_id);
    if (!hasAccess) {
      throw createError(
        403,
        ErrorCodes.FORBIDDEN,
        "You do not have access to this record",
      );
    }

    if (record.status !== "draft") {
      throw createError(
        409,
        ErrorCodes.CONFLICT,
        "Only draft records can be reviewed",
      );
    }

    const updated = await db.record.update({
      where: { id },
      data: {
        status: "reviewed",
        reviewed_at: new Date(),
        reviewed_by: user.id,
      },
    });

    return c.json(updated);
  },
);

records.patch(
  "/:id",
  requireRole("admin", "provider"),
  auditLog("record.update", "record"),
  zValidator("json", UpdateRecordSchema),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user");

    const record = await db.record.findUnique({
      where: { id },
    });

    if (!record) {
      throw createError(404, ErrorCodes.NOT_FOUND, "Record not found");
    }

    const hasAccess = await checkPatientAccess(c, record.patient_id);
    if (!hasAccess) {
      throw createError(
        403,
        ErrorCodes.FORBIDDEN,
        "You do not have access to this record",
      );
    }

    // PLANTED-BUG-#10: Partial immutability bug
    // Body is protected when status is reviewed, but title is not
    if (record.status === "reviewed" && data.body !== undefined) {
      throw createError(
        409,
        ErrorCodes.CONFLICT,
        "Cannot edit body of reviewed record",
      );
    }

    // PLANTED-BUG-#10: Title can still be edited even when reviewed
    const updateData: any = {};
    if (data.title !== undefined) {
      updateData.title = data.title;
    }
    if (data.body !== undefined) {
      updateData.body = data.body;
    }

    const updated = await db.record.update({
      where: { id },
      data: updateData,
    });

    return c.json(updated);
  },
);

export default records;
