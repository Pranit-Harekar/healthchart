import { z } from "zod";

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z
      .array(
        z.object({
          field: z.string().optional(),
          issue: z.string(),
        }),
      )
      .optional(),
  }),
});

export const PaginationQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 20;
      const num = parseInt(val, 10);
      return Math.min(Math.max(num, 1), 100);
    }),
  cursor: z.string().optional(),
});

export const PaginationResponseSchema = z.object({
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

export const RoleSchema = z.enum([
  "admin",
  "provider",
  "billing_staff",
  "patient",
]);
export const PatientStatusSchema = z.enum(["active", "inactive", "deceased"]);
export const AppointmentStatusSchema = z.enum([
  "requested",
  "confirmed",
  "checked_in",
  "completed",
  "cancelled",
  "no_show",
]);
export const RecordTypeSchema = z.enum([
  "visit_note",
  "lab_result",
  "imaging",
  "vaccination",
  "mental_health",
  "substance_use",
  "general",
]);
export const RecordStatusSchema = z.enum(["draft", "reviewed"]);
