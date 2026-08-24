import type { Context, Next } from "hono";
import type { Variables } from "../types/context.js";
import { verifyToken } from "../lib/supabase.js";
import { prisma } from "../lib/db.js";
import { createError, ErrorCodes } from "../lib/errors.js";

export async function requireAuth(
  c: Context<{ Variables: Variables }>,
  next: Next,
) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw createError(
      401,
      ErrorCodes.UNAUTHENTICATED,
      "Missing or invalid authorization header",
    );
  }

  const token = authHeader.replace("Bearer ", "");
  const supabaseUser = await verifyToken(token);

  if (!supabaseUser) {
    throw createError(
      401,
      ErrorCodes.UNAUTHENTICATED,
      "Invalid or expired token",
    );
  }

  // Fetch user profile from database
  const profile = await prisma.profile.findUnique({
    where: { id: supabaseUser.id },
  });

  if (!profile) {
    throw createError(
      401,
      ErrorCodes.UNAUTHENTICATED,
      "User profile not found",
    );
  }

  c.set("user", {
    id: profile.id,
    role: profile.role,
    email: supabaseUser.email || "",
    full_name: profile.full_name,
    sensitive_access: profile.sensitive_access,
    linked_patient_id: profile.linked_patient_id,
  });

  c.set("db", prisma);

  await next();
}
