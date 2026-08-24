import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { supabaseAdmin } from "../lib/supabase.js";
import { prisma } from "../lib/db.js";
import { createError, ErrorCodes } from "../lib/errors.js";
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
} from "../schemas/auth.schema.js";
import { authLoginRateLimit } from "../middleware/rate-limit.js";
import type { Variables } from "../types/context.js";

const auth = new Hono<{ Variables: Variables }>();

// Track failed login attempts for account locking
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

auth.post("/register", zValidator("json", RegisterSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Create Supabase auth user
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
      });

    if (authError || !authData.user) {
      throw createError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        authError?.message || "Failed to create user",
      );
    }

    // If role is patient and no linked_patient_id provided, create a new patient
    let linkedPatientId = data.linked_patient_id;
    if (data.role === "patient" && !linkedPatientId) {
      const patient = await prisma.patient.create({
        data: {
          first_name: data.full_name.split(" ")[0] || data.full_name,
          last_name: data.full_name.split(" ").slice(1).join(" ") || "",
          date_of_birth: new Date("1990-01-01"), // Placeholder
          email: data.email,
        },
      });
      linkedPatientId = patient.id;
    }

    // Create profile
    const profile = await prisma.profile.create({
      data: {
        id: authData.user.id,
        role: data.role,
        full_name: data.full_name,
        sensitive_access: false,
        linked_patient_id: linkedPatientId,
      },
    });

    // Generate session tokens
    const { data: sessionData, error: sessionError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: data.email,
      });

    return c.json(
      {
        user: {
          id: profile.id,
          email: data.email,
          role: profile.role,
          full_name: profile.full_name,
        },
        message:
          "User registered successfully. Please use /auth/login to get tokens.",
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && "statusCode" in error) {
      throw error;
    }
    throw createError(500, ErrorCodes.INTERNAL_ERROR, "Internal server error");
  }
});

auth.post(
  "/login",
  authLoginRateLimit,
  zValidator("json", LoginSchema),
  async (c) => {
    const { email, password } = c.req.valid("json");

    // Check if account is locked
    const attempts = loginAttempts.get(email);
    if (attempts && attempts.count >= 5 && attempts.resetAt > Date.now()) {
      throw createError(
        423,
        ErrorCodes.LOCKED,
        "Account locked due to too many failed login attempts",
      );
    }

    try {
      const { data, error } = await supabaseAdmin.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.user) {
        // Track failed attempt
        const existing = loginAttempts.get(email);
        if (existing && existing.resetAt > Date.now()) {
          existing.count++;
        } else {
          loginAttempts.set(email, {
            count: 1,
            resetAt: Date.now() + 15 * 60 * 1000, // 15 minutes
          });
        }

        throw createError(
          401,
          ErrorCodes.UNAUTHENTICATED,
          "Invalid credentials",
        );
      }

      // Clear failed attempts on successful login
      loginAttempts.delete(email);

      // Fetch profile
      const profile = await prisma.profile.findUnique({
        where: { id: data.user.id },
      });

      if (!profile) {
        throw createError(
          401,
          ErrorCodes.UNAUTHENTICATED,
          "User profile not found",
        );
      }

      return c.json({
        access_token: data.session!.access_token,
        refresh_token: data.session!.refresh_token,
        user: {
          id: profile.id,
          email: data.user.email!,
          role: profile.role,
          full_name: profile.full_name,
        },
      });
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) {
        throw error;
      }
      throw createError(
        500,
        ErrorCodes.INTERNAL_ERROR,
        "Internal server error",
      );
    }
  },
);

auth.post("/refresh", zValidator("json", RefreshTokenSchema), async (c) => {
  const { refresh_token } = c.req.valid("json");

  try {
    const { data, error } = await supabaseAdmin.auth.refreshSession({
      refresh_token,
    });

    if (error || !data.session) {
      throw createError(
        401,
        ErrorCodes.UNAUTHENTICATED,
        "Invalid refresh token",
      );
    }

    return c.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (error) {
    if (error instanceof Error && "statusCode" in error) {
      throw error;
    }
    throw createError(500, ErrorCodes.INTERNAL_ERROR, "Internal server error");
  }
});

auth.post("/logout", async (c) => {
  // In a real app, we'd invalidate the token
  // For this sandbox, we'll just return success
  return c.json({ message: "Logged out successfully" });
});

export default auth;
