import { z } from "zod";
import { AppointmentStatusSchema } from "./common.schema.js";

export const CreateAppointmentSchema = z
  .object({
    patient_id: z.string().uuid(),
    provider_id: z.string().uuid(),
    start_time: z.string().datetime(),
    end_time: z.string().datetime(),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (data) => {
      const start = new Date(data.start_time);
      const end = new Date(data.end_time);
      const durationMinutes = (end.getTime() - start.getTime()) / (60 * 1000);
      return end > start && durationMinutes >= 10 && durationMinutes <= 240;
    },
    {
      message:
        "End time must be after start time, and duration must be between 10 and 240 minutes",
    },
  );

export const AppointmentResponseSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  start_time: z.string(),
  end_time: z.string(),
  status: AppointmentStatusSchema,
  reason: z.string().nullable(),
  cancelled_reason: z.string().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const AppointmentListQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  patient_id: z.string().uuid().optional(),
  provider_id: z.string().uuid().optional(),
  status: AppointmentStatusSchema.optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

export const CancelAppointmentSchema = z.object({
  cancelled_reason: z.string().optional(),
});
