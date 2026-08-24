import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { createError, ErrorCodes } from "../lib/errors.js";
import { AuditLogListQuerySchema } from "../schemas/audit.schema.js";
import type { Variables } from "../types/context.js";

const audit = new Hono<{ Variables: Variables }>();

audit.use("/*", requireAuth, requireRole("admin"));

audit.get("/", zValidator("query", AuditLogListQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const db = c.get("db");

  // PLANTED-BUG-#7: Inconsistent pagination limit validation
  // Other list endpoints clamp limit to 100, but this one returns 400 VALIDATION_ERROR
  const limit = parseInt(query.limit || "20");
  if (limit > 100) {
    throw createError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      "Limit cannot exceed 100",
      [{ field: "limit", issue: "must be 100 or less" }],
    );
  }

  const cursor = query.cursor;

  const where: any = {};

  if (query.patient_id) {
    where.patient_id = query.patient_id;
  }

  if (query.actor_id) {
    where.actor_id = query.actor_id;
  }

  if (query.action) {
    where.action = query.action;
  }

  if (query.start_date || query.end_date) {
    where.created_at = {};
    if (query.start_date) {
      where.created_at.gte = new Date(query.start_date);
    }
    if (query.end_date) {
      where.created_at.lte = new Date(query.end_date);
    }
  }

  if (cursor) {
    where.id = { gt: cursor };
  }

  const items = await db.auditLog.findMany({
    where,
    take: limit + 1,
    orderBy: { created_at: "desc" },
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
});

export default audit;
