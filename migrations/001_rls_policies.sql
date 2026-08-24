-- Enable Row Level Security on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Patients: Providers can see assigned patients
CREATE POLICY "Providers see assigned patients"
  ON patients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'provider'
      AND profiles.id = patients.assigned_provider_id
    )
  );

-- Patients: Billing staff can see consenting patients
CREATE POLICY "Billing staff see consenting patients"
  ON patients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'billing_staff'
    )
    AND consent_data_sharing = true
    AND deleted_at IS NULL
  );

-- Patients: Patients can see their own record
CREATE POLICY "Patients see own record"
  ON patients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'patient'
      AND profiles.linked_patient_id = patients.id
    )
  );

-- Appointments: Users can see appointments related to their patients
CREATE POLICY "Appointments access by role"
  ON appointments FOR SELECT
  USING (
    -- Providers see their appointments
    (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'provider'
        AND profiles.id = appointments.provider_id
      )
    )
    OR
    -- Patients see their own appointments
    (
      EXISTS (
        SELECT 1 FROM profiles
        JOIN patients ON patients.id = profiles.linked_patient_id
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'patient'
        AND patients.id = appointments.patient_id
      )
    )
  );

-- Records: Providers see records for assigned patients
CREATE POLICY "Providers see patient records"
  ON records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      JOIN patients ON patients.assigned_provider_id = profiles.id
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'provider'
      AND patients.id = records.patient_id
    )
  );

-- Records: Patients see their own reviewed records
CREATE POLICY "Patients see own reviewed records"
  ON records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      JOIN patients ON patients.id = profiles.linked_patient_id
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'patient'
      AND patients.id = records.patient_id
      AND records.status = 'reviewed'
    )
  );

-- Audit logs: Admin only
CREATE POLICY "Admin can read audit logs"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Audit logs: Append-only (no UPDATE or DELETE)
-- This is enforced at the Postgres permission level, not RLS
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;

-- Note: These RLS policies are defense-in-depth
-- Primary authorization enforcement is at the application layer
