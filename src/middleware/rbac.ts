import type { Context, Next } from "hono";
import type { Variables } from "../types/context.js";
import { createError, ErrorCodes } from "../lib/errors.js";

export function requireRole(
  ...allowedRoles: Array<"admin" | "provider" | "billing_staff" | "patient">
) {
  return async (c: Context<{ Variables: Variables }>, next: Next) => {
    const user = c.get("user");

    if (!user || !allowedRoles.includes(user.role)) {
      throw createError(
        403,
        ErrorCodes.FORBIDDEN,
        "You do not have permission to access this resource",
      );
    }

    await next();
  };
}

export async function checkPatientAccess(
  c: Context<{ Variables: Variables }>,
  patientId: string,
): Promise<boolean> {
  const user = c.get("user");
  const db = c.get("db");

  if (user.role === "admin") {
    return true;
  }

  if (user.role === "patient") {
    return user.linked_patient_id === patientId;
  }

  if (user.role === "provider") {
    const patient = await db.patient.findUnique({
      where: { id: patientId },
      select: { assigned_provider_id: true },
    });
    return patient?.assigned_provider_id === user.id;
  }

  if (user.role === "billing_staff") {
    const patient = await db.patient.findUnique({
      where: { id: patientId },
      select: { consent_data_sharing: true, deleted_at: true },
    });
    return !!patient && patient.consent_data_sharing && !patient.deleted_at;
  }

  return false;
}
