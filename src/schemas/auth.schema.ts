import { z } from "zod";
import { RoleSchema } from "./common.schema.js";

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1).max(100),
  role: RoleSchema,
  linked_patient_id: z.string().uuid().optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const AuthResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: RoleSchema,
    full_name: z.string(),
  }),
});

export const RefreshTokenSchema = z.object({
  refresh_token: z.string(),
});
