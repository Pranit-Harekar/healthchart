import type { PrismaClient } from "@prisma/client";

export interface User {
  id: string;
  role: "admin" | "provider" | "billing_staff" | "patient";
  email: string;
  full_name: string;
  sensitive_access: boolean;
  linked_patient_id: string | null;
}

export type Variables = {
  user: User;
  db: PrismaClient;
};
