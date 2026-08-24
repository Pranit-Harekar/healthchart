import type { Context, Next } from "hono";
import type { Variables } from "../types/context.js";
import { Prisma } from "@prisma/client";

export function auditLog(action: string, resourceType: string) {
  return async (c: Context<{ Variables: Variables }>, next: Next) => {
    await next();

    // PLANTED-BUG-#4: If audit log write fails, the request still succeeds
    // This is intentional to test whether QA verifies side effects
    try {
      const user = c.get("user");
      const db = c.get("db");

      if (!user || !db) return;

      const resourceId = c.req.param("id") || null;
      const patientId = c.req.param("patientId") || c.req.param("id") || null;
      const ipAddress =
        c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || null;

      await db.auditLog.create({
        data: {
          actor_id: user.id,
          actor_role: user.role,
          action,
          resource_type: resourceType,
          resource_id: resourceId,
          patient_id: patientId,
          ip_address: ipAddress,
          metadata: Prisma.JsonNull,
        },
      });
    } catch (error) {
      // PLANTED-BUG-#4: Silent failure - only log to console, don't throw
      console.error("Audit log write failed:", error);
    }
  };
}
