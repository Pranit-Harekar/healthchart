import { z } from "zod";
import { RecordTypeSchema, RecordStatusSchema } from "./common.schema.js";

export const CreateRecordSchema = z.object({
  appointment_id: z.string().uuid().optional(),
  record_type: RecordTypeSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

export const UpdateRecordSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(10000).optional(),
});

export const RecordResponseSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullable(),
  author_id: z.string().uuid(),
  record_type: RecordTypeSchema,
  title: z.string(),
  body: z.string(),
  status: RecordStatusSchema,
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const RecordListQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  record_type: RecordTypeSchema.optional(),
  status: RecordStatusSchema.optional(),
});
