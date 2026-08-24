import { z } from "zod";

export const AuditLogResponseSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  actor_role: z.string(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().uuid().nullable(),
  patient_id: z.string().uuid().nullable(),
  metadata: z.any().nullable(),
  ip_address: z.string().nullable(),
  created_at: z.string(),
});

export const AuditLogListQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  patient_id: z.string().uuid().optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});
