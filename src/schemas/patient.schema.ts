import { z } from "zod";
import { PatientStatusSchema } from "./common.schema.js";

export const AddressSchema = z
  .object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    postal_code: z.string(),
    country: z.string(),
  })
  .nullable();

export const CreatePatientSchema = z.object({
  first_name: z.string().min(1).max(100).trim(),
  last_name: z.string().min(1).max(100).trim(),
  date_of_birth: z.string().refine(
    (val) => {
      const date = new Date(val);
      const now = new Date();
      const age =
        (now.getTime() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      return date < now && age >= 0 && age <= 130;
    },
    {
      message:
        "Date of birth must be in the past and imply age between 0 and 130 years",
    },
  ),
  email: z.string().email(),
  phone: z.string().optional(),
  address: AddressSchema.optional(),
  assigned_provider_id: z.string().uuid().optional(),
});

export const UpdatePatientSchema = z.object({
  first_name: z.string().min(1).max(100).trim().optional(),
  last_name: z.string().min(1).max(100).trim().optional(),
  date_of_birth: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: AddressSchema.optional(),
  assigned_provider_id: z.string().uuid().optional(),
  status: PatientStatusSchema.optional(),
});

export const UpdatePatientConsentSchema = z.object({
  consent_data_sharing: z.boolean(),
});

export const PatientResponseSchema = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  last_name: z.string(),
  date_of_birth: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  address: AddressSchema,
  assigned_provider_id: z.string().uuid().nullable(),
  consent_data_sharing: z.boolean(),
  consent_updated_at: z.string().nullable(),
  status: PatientStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export const PatientListQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  status: PatientStatusSchema.optional(),
  assigned_provider_id: z.string().uuid().optional(),
});
