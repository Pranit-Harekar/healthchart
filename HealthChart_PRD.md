# Product Requirements Document: HealthChart

**Document owner:** Pranit Harekar
**Status:** Draft v1.0
**Purpose of this document:** This PRD is written to be handed to an AI coding agent (or human engineer) to build the project end-to-end with minimal ambiguity. It intentionally over-specifies behavior, error shapes, and edge cases because the primary purpose of the product is to serve as a **QA testing sandbox** — a realistic-feeling healthcare API that a QA engineer can exercise across functional, security, compliance, concurrency, and negative-testing scenarios.

---

## 1. Product Overview

### 1.1 What is HealthChart

HealthChart is a backend-only REST API that simulates a **patient appointment and records portal**, similar in spirit to a small clinic's practice management system. It is **not** a production healthcare product and will never store real patient data. Its purpose is to give a QA engineer (or QA team) a realistic, self-hosted API surface to practice and demonstrate the full range of QA testing disciplines against, including:

- Functional / CRUD testing
- Input validation & boundary testing
- Authentication testing
- Authorization / RBAC testing (including field-level and record-type-level access control)
- Compliance-flavored testing (audit logging, consent propagation, data redaction)
- Concurrency / race-condition testing
- Idempotency testing
- Pagination / filtering testing
- Rate limiting testing
- Error-contract consistency testing

### 1.2 Non-goals

- HealthChart is **not** a real EHR/EMR and will not integrate with real healthcare systems (no HL7, FHIR, insurance, or billing integrations in v1).
- HealthChart does **not** need to be HIPAA-compliant in a legally binding sense — it borrows HIPAA-_shaped_ concepts (audit trails, consent, sensitive record redaction) for realism, not for actual regulatory compliance.
- No real patient data will ever be used or stored. All seed/test data is synthetic.
- No frontend/UI is in scope for v1. This is an API-only project. (A minimal Swagger/OpenAPI UI for exploration is in scope — see §7.)

### 1.3 Target user of the _product itself_

The "user" of HealthChart is a QA engineer (possibly Pranit himself, or others he shares this with) who will write test plans, test cases, and automated test suites (Postman/Newman, REST Assured, Playwright API testing, k6, etc.) against this API.

### 1.4 Success criteria

- A QA engineer can identify and execute at least 8 distinct categories of test cases against the API without needing to modify source code.
- The API contains a documented set of **intentionally planted bugs** (see §10) that a thorough QA engineer should be able to discover through testing — these serve as an answer key / self-assessment tool.
- The API behaves consistently enough (predictable error shapes, consistent status codes) that a QA engineer can write reliable automated regression tests against it.

---

## 2. Tech Stack

| Layer                                                          | Choice                                                                                                    | Notes                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Language/runtime                                               | TypeScript on Node.js (v20+)                                                                              |                                                                                                                        |
| API framework                                                  | [Hono](https://hono.dev)                                                                                  | Chosen for speed, minimal abstraction, and Web Standards-based API                                                     |
| Validation                                                     | Zod                                                                                                       | Used for request schema validation; schemas should be defined once and reused for both validation and TypeScript types |
| Database                                                       | PostgreSQL via Supabase                                                                                   | One Supabase project per environment (staging, production) — see §9                                                    |
| Auth                                                           | Supabase Auth (JWT-based)                                                                                 | Email/password only for v1. No OAuth/social login needed.                                                              |
| ORM/query layer                                                | Prisma ORM (preferred) or Supabase JS client with raw SQL where needed                                    | Agent may choose based on best fit for RLS interplay — see §5.7                                                        |
| Deployment                                                     | Render (Web Service)                                                                                      | Two environments: staging and production — see §9                                                                      |
| API documentation                                              | OpenAPI 3.1 spec, auto-generated from Zod schemas (`@hono/zod-openapi`) or hand-maintained `openapi.yaml` | Must be served at `/docs` via Swagger UI or Scalar                                                                     |
| Testing (project's own test suite, separate from QA scenarios) | Vitest + Supertest-equivalent for Hono                                                                    | Basic smoke tests only — the "real" QA testing happens externally against the deployed API                             |

---

## 3. Roles & Personas

HealthChart supports **four roles**. Every user account has exactly one role at a time (no multi-role users in v1).

| Role            | Description                             | Can generally do                                                                                                                                                   |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `admin`         | System administrator                    | Full access to all endpoints, including audit logs and user management                                                                                             |
| `provider`      | A clinician (doctor/nurse practitioner) | Can view/manage only patients they are assigned to; can create/view clinical records; **cannot** see audit logs                                                    |
| `billing_staff` | Administrative/billing staff            | Can view patient demographic and appointment data; **cannot** view clinical notes or sensitive record types                                                        |
| `patient`       | The patient themselves                  | Can view only their own data; can view their own appointments and _reviewed_ (finalized) records; can update their own consent; cannot see internal provider notes |

### 3.1 Role capability matrix (authoritative — implement exactly as specified)

| Action                                           | admin | provider                                                                                 | billing_staff | patient                                  |
| ------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------- | ------------- | ---------------------------------------- |
| Create patient                                   | ✅    | ✅                                                                                       | ✅            | ❌                                       |
| View any patient's demographics                  | ✅    | ✅ (only assigned patients)                                                              | ✅            | ❌ (self only)                           |
| Update patient demographics                      | ✅    | ✅ (only assigned patients)                                                              | ✅            | ✅ (self only, limited fields)           |
| Delete (soft-delete) patient                     | ✅    | ❌                                                                                       | ❌            | ❌                                       |
| Create appointment                               | ✅    | ✅                                                                                       | ✅            | ✅ (self only, requests only — see §6.4) |
| View appointment                                 | ✅    | ✅ (own patients)                                                                        | ✅            | ✅ (self only)                           |
| Cancel appointment                               | ✅    | ✅ (own patients)                                                                        | ✅            | ✅ (self only)                           |
| Create clinical record                           | ✅    | ✅ (own patients)                                                                        | ❌            | ❌                                       |
| View clinical record (general type)              | ✅    | ✅ (own patients)                                                                        | ❌            | ✅ (self only, if `status = reviewed`)   |
| View clinical record (sensitive type — see §6.5) | ✅    | ✅ (own patients, **and** must have `sensitive_access = true` on their provider profile) | ❌            | ✅ (self only, if `status = reviewed`)   |
| Update patient consent                           | ✅    | ❌                                                                                       | ❌            | ✅ (self only)                           |
| View audit logs                                  | ✅    | ❌                                                                                       | ❌            | ❌                                       |
| Manage users/roles                               | ✅    | ❌                                                                                       | ❌            | ❌                                       |

Any request that violates this matrix must return `403 Forbidden` with the standard error shape (§8.2) — never a `404`, since leaking "exists but forbidden" vs "doesn't exist" is itself a testable authorization nuance the QA engineer should be able to probe (see §10 for where this is _intentionally_ implemented inconsistently as a plantable bug).

---

## 4. Data Model

Use PostgreSQL. All tables use UUID primary keys (`gen_random_uuid()`). All tables have `created_at` and `updated_at` timestamps (UTC, `timestamptz`). Use `snake_case` for all column names.

### 4.1 `users`

Managed primarily by Supabase Auth (`auth.users`), extended with a `profiles` table.

```
profiles
- id (uuid, PK, FK -> auth.users.id)
- role (enum: admin | provider | billing_staff | patient) NOT NULL
- full_name (text) NOT NULL
- sensitive_access (boolean) NOT NULL DEFAULT false   -- only meaningful for provider role
- linked_patient_id (uuid, FK -> patients.id, nullable) -- set only when role = patient
- created_at, updated_at
```

### 4.2 `patients`

```
patients
- id (uuid, PK)
- first_name (text) NOT NULL
- last_name (text) NOT NULL
- date_of_birth (date) NOT NULL
- email (text) NOT NULL, unique
- phone (text) nullable
- address (jsonb) nullable   -- {line1, line2, city, state, postal_code, country}
- assigned_provider_id (uuid, FK -> profiles.id) nullable
- consent_data_sharing (boolean) NOT NULL DEFAULT false
- consent_updated_at (timestamptz) nullable
- status (enum: active | inactive | deceased) NOT NULL DEFAULT 'active'
- deleted_at (timestamptz) nullable   -- soft delete
- created_at, updated_at
```

Validation rules:

- `date_of_birth` must be in the past and imply an age between 0 and 130 years.
- `email` must be valid format and unique among non-deleted patients.
- `first_name`, `last_name`: 1–100 chars, no leading/trailing whitespace.

### 4.3 `appointments`

```
appointments
- id (uuid, PK)
- patient_id (uuid, FK -> patients.id) NOT NULL
- provider_id (uuid, FK -> profiles.id) NOT NULL
- start_time (timestamptz) NOT NULL
- end_time (timestamptz) NOT NULL
- status (enum: requested | confirmed | checked_in | completed | cancelled | no_show) NOT NULL DEFAULT 'requested'
- reason (text) nullable, max 500 chars
- cancelled_reason (text) nullable
- created_by (uuid, FK -> profiles.id) NOT NULL
- created_at, updated_at
```

Validation rules:

- `end_time` must be after `start_time`.
- Appointment duration must be between 10 and 240 minutes.
- `start_time` must not be in the past **at creation time** (but see §10 for a deliberately buggy variant).
- No two `confirmed` or `checked_in` appointments for the same `provider_id` may have overlapping `[start_time, end_time)` ranges (this is the primary concurrency test target — see §6.4 and §10).

### 4.4 `records` (clinical records)

```
records
- id (uuid, PK)
- patient_id (uuid, FK -> patients.id) NOT NULL
- appointment_id (uuid, FK -> appointments.id) nullable
- author_id (uuid, FK -> profiles.id) NOT NULL   -- provider who wrote it
- record_type (enum: visit_note | lab_result | imaging | vaccination | mental_health | substance_use | general) NOT NULL
- title (text) NOT NULL, max 200 chars
- body (text) NOT NULL, max 10000 chars
- status (enum: draft | reviewed) NOT NULL DEFAULT 'draft'
- reviewed_at (timestamptz) nullable
- reviewed_by (uuid, FK -> profiles.id) nullable
- created_at, updated_at
```

`record_type` values `mental_health` and `substance_use` are **sensitive types**. See §6.5 for special access rules — this models the real-world 42 CFR Part 2 distinction referenced in earlier scoping.

### 4.5 `audit_logs`

```
audit_logs
- id (uuid, PK)
- actor_id (uuid, FK -> profiles.id) nullable   -- null if system-generated
- actor_role (text) NOT NULL   -- denormalized snapshot of role at time of action
- action (text) NOT NULL   -- e.g. "patient.view", "record.create", "consent.update"
- resource_type (text) NOT NULL   -- e.g. "patient", "record", "appointment"
- resource_id (uuid) nullable
- patient_id (uuid) nullable   -- denormalized for fast filtering; the patient this action concerned
- metadata (jsonb) nullable   -- e.g. {"fields_changed": ["email"]}
- ip_address (text) nullable
- created_at (timestamptz) NOT NULL DEFAULT now()
```

Audit logs are **append-only**. No UPDATE or DELETE endpoint should ever exist for this table, and DB-level permissions should enforce this (revoke UPDATE/DELETE grants at the Postgres level, not just at the app layer).

### 4.6 Entity-relationship summary

```
profiles (1) ---- (0..1) patients        [via linked_patient_id, only for role=patient]
patients (1) ---- (0..*) appointments
patients (1) ---- (0..*) records
profiles/provider (1) ---- (0..*) appointments
profiles/provider (1) ---- (0..*) records [as author]
patients (1) ---- (0..*) audit_logs [denormalized reference]
```

---

## 5. Authentication & Authorization

### 5.1 Authentication mechanism

- Supabase Auth, email + password only.
- All API requests (except `POST /auth/register`, `POST /auth/login`, `GET /health`, `GET /docs`) require a valid `Authorization: Bearer <jwt>` header.
- JWT expiry: access token 1 hour, refresh token 30 days (Supabase defaults are acceptable).

### 5.2 Registration flow

- `POST /auth/register` creates a Supabase Auth user **and** a corresponding `profiles` row in the same logical operation.
- Registration requires a `role` field. For v1 simplicity, **any caller can self-register as any role** (no invite-only gating) — this is intentional to keep the sandbox easy to seed and test, but it is documented in §10 as a "real-world would never do this" callout, since it's a great authz test discussion point.
- Patients registering with role `patient` must additionally provide `linked_patient_id` referencing an existing `patients` record, OR the system auto-creates a new `patients` record and links it (implementer's choice — document whichever is chosen in the README).

### 5.3 Login flow

- `POST /auth/login` — standard email/password, returns access + refresh tokens.
- Lock the account (return `423 Locked`) after 5 consecutive failed login attempts within 15 minutes, unlocking automatically after 15 minutes. This is a deliberate testable security control.

### 5.4 Middleware requirements

Implement Hono middleware in this order for every protected route:

1. **Auth middleware** — validates JWT, attaches `ctx.user = { id, role, ... }` or returns `401 Unauthorized`.
2. **Role/ownership middleware** — per-route, checks role matrix (§3.1) and record-level ownership (e.g., provider must be `assigned_provider_id` on the patient). Returns `403 Forbidden` on violation.
3. **Audit middleware** — after the route handler completes successfully, writes an `audit_logs` row. Must run regardless of success, for all state-changing operations (POST/PATCH/DELETE) and for all reads of patient records (GET on `/patients/:id` and `/patients/:id/records`).

### 5.5 Row Level Security (RLS)

Since the database is Postgres via Supabase, **enable RLS on every table** as defense-in-depth, even though the Hono app layer also enforces authorization. Do not rely on RLS alone — the app-layer checks in §5.4 must exist independently. This dual-layer approach is itself a good QA discussion point (testing "what if the app-layer check has a bug — does RLS catch it").

Suggested RLS policy shape for `patients`:

```sql
-- providers can select only patients assigned to them
-- billing_staff can select all non-deleted patients
-- patients can select only their own linked row
-- admin bypasses via service role or explicit admin policy
```

(Full policy SQL should be written out in the implementation, not left as pseudocode — the agent building this should generate complete `.sql` migration files.)

### 5.6 Consent enforcement

When `patients.consent_data_sharing = false`:

- `billing_staff` role loses read access to that patient's demographic record entirely (`403`).
- This must take effect **immediately** — i.e., revoking consent must not require a cache flush, token refresh, or any delay. This is a deliberate state-propagation test target (see §10).

### 5.7 ORM note for the agent

If using Prisma: still write RLS policies as raw SQL migrations (Prisma doesn't manage RLS natively). If using the Supabase JS client with the service role key for the Hono backend, RLS is bypassed by default — in that case RLS still must be enabled and tested via a _separate_ Supabase anon/authenticated client path for defense-in-depth verification, but the primary authorization enforcement point is the app-layer middleware in §5.4. Document which approach was taken in the README.

---

## 6. API Endpoints

Base path: `/api/v1`

All endpoints return JSON. All list endpoints support pagination (§6.7). All timestamps in requests/responses are ISO 8601 UTC.

### 6.1 Auth

| Method | Path             | Auth required               | Description                   |
| ------ | ---------------- | --------------------------- | ----------------------------- |
| POST   | `/auth/register` | No                          | Register a new user + profile |
| POST   | `/auth/login`    | No                          | Login, returns tokens         |
| POST   | `/auth/refresh`  | No (requires refresh token) | Refresh access token          |
| POST   | `/auth/logout`   | Yes                         | Invalidate refresh token      |

### 6.2 Patients

| Method | Path            | Roles allowed                                                        | Description                                                               |
| ------ | --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| POST   | `/patients`     | admin, provider, billing_staff                                       | Create patient                                                            |
| GET    | `/patients`     | admin, provider, billing_staff                                       | List patients (paginated, filterable by `status`, `assigned_provider_id`) |
| GET    | `/patients/:id` | admin, provider (own), billing_staff, patient (self)                 | Get patient detail                                                        |
| PATCH  | `/patients/:id` | admin, provider (own), billing_staff, patient (self, limited fields) | Update patient                                                            |
| DELETE | `/patients/:id` | admin only                                                           | Soft-delete patient (sets `deleted_at`, `status = inactive`)              |

Field-level restriction on `PATCH /patients/:id` when caller role is `patient`: only `phone`, `address`, `email` are editable. Attempting to change `first_name`, `last_name`, `date_of_birth`, `assigned_provider_id`, or `status` as a patient must return `403` (not silently ignore the field — silently ignoring is a plantable bug, see §10).

### 6.3 Consent

| Method | Path                    | Roles allowed         | Description                   |
| ------ | ----------------------- | --------------------- | ----------------------------- |
| PATCH  | `/patients/:id/consent` | admin, patient (self) | Update `consent_data_sharing` |

Request body: `{ "consent_data_sharing": boolean }`. Must write an audit log entry with `action = "consent.update"` and `metadata: { "previous_value": bool, "new_value": bool }`.

### 6.4 Appointments

| Method | Path                         | Roles allowed                                                                   | Description                                                                                    |
| ------ | ---------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| POST   | `/appointments`              | admin, provider, billing_staff, patient (self, creates status=`requested` only) | Create appointment                                                                             |
| GET    | `/appointments`              | admin, provider (own), billing_staff, patient (self)                            | List appointments (paginated, filterable by `patient_id`, `provider_id`, `status`, date range) |
| GET    | `/appointments/:id`          | admin, provider (own), billing_staff, patient (self)                            | Get appointment detail                                                                         |
| PATCH  | `/appointments/:id/confirm`  | admin, provider, billing_staff                                                  | Confirm a `requested` appointment → `confirmed`                                                |
| PATCH  | `/appointments/:id/checkin`  | admin, provider, billing_staff                                                  | `confirmed` → `checked_in`                                                                     |
| PATCH  | `/appointments/:id/complete` | admin, provider                                                                 | `checked_in` → `completed`                                                                     |
| PATCH  | `/appointments/:id/cancel`   | admin, provider, billing_staff, patient (self)                                  | Any non-terminal status → `cancelled`                                                          |

State machine (enforce strictly server-side, return `409 Conflict` on illegal transitions):

```
requested → confirmed → checked_in → completed
    ↓            ↓            ↓
cancelled    cancelled    cancelled
```

`no_show` is set via a separate implicit rule: not user-triggered in v1 (out of scope — could be a future scheduled job). `completed` and `cancelled` are terminal; no further transitions allowed from those states.

**Double-booking check** (critical QA target): when creating or confirming an appointment, the system must check for overlapping `confirmed`/`checked_in` appointments for the same `provider_id`. This check and the subsequent insert/update **must happen atomically** — use a DB-level unique constraint or `SELECT ... FOR UPDATE` transaction, not an application-level check-then-write (which would be racy). Document in the README whether this was implemented via Postgres exclusion constraint (`EXCLUDE USING gist`) or transactional locking — exclusion constraint is the preferred, more robust approach.

### 6.5 Records

| Method | Path                    | Roles allowed                                                                                                     | Description                                                                               |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| POST   | `/patients/:id/records` | admin, provider (own)                                                                                             | Create clinical record (defaults to `status = draft`)                                     |
| GET    | `/patients/:id/records` | admin, provider (own, with sensitive-type filtering), patient (self, reviewed only)                               | List records for a patient                                                                |
| GET    | `/records/:id`          | admin, provider (own, with sensitive-type filtering), patient (self, if reviewed)                                 | Get single record                                                                         |
| PATCH  | `/records/:id/review`   | admin, provider (own, original author or same-team — for v1, just require same `assigned_provider_id` as patient) | Transition `draft` → `reviewed`, sets `reviewed_at`/`reviewed_by`                         |
| PATCH  | `/records/:id`          | admin, provider (own, only while `status = draft`)                                                                | Edit record content — must return `409` if already `reviewed` (immutability after review) |

**Sensitive record type rule**: if `record_type` is `mental_health` or `substance_use`:

- A `provider` caller must have `profiles.sensitive_access = true`, in addition to being the assigned provider, or the record is **excluded from list results** (not a 403 on the list endpoint — it's silently filtered, since a list endpoint mixing visible and invisible items shouldn't error, it should just omit). For `GET /records/:id` directly, however, return `403` if the specific record is sensitive and the caller lacks access.
- A `patient` caller can always see their own reviewed sensitive records regardless of any provider-side flag (this models patient right-of-access, which is real and important — do not gate patients' access to their own sensitive records).

**Draft visibility rule**: records with `status = draft` are never visible to `patient` role, regardless of type, even if they'd otherwise be entitled to see them once reviewed. This is the "premature disclosure" test target flagged earlier in scoping.

### 6.6 Audit Logs

| Method | Path          | Roles allowed | Description                                                                              |
| ------ | ------------- | ------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/audit-logs` | admin only    | List audit logs, paginated, filterable by `patient_id`, `actor_id`, `action`, date range |

### 6.7 Pagination (applies to all list endpoints)

Use cursor-based pagination:

- Query params: `?limit=20&cursor=<opaque_cursor>`
- `limit`: default 20, max 100. Values above 100 should be clamped to 100, not error (document this choice — it's a good "what should happen at the boundary" QA discussion point, and differs deliberately from the validation-error approach used elsewhere, see §10).
- Response shape:

```json
{
  "data": [ ... ],
  "pagination": {
    "next_cursor": "opaque-string-or-null",
    "has_more": true
  }
}
```

### 6.8 Health & docs

| Method | Path      | Auth | Description                                      |
| ------ | --------- | ---- | ------------------------------------------------ |
| GET    | `/health` | No   | Returns `{ "status": "ok", "timestamp": "..." }` |
| GET    | `/docs`   | No   | Swagger UI / Scalar rendering the OpenAPI spec   |

---

## 7. API Documentation Requirements

- Full OpenAPI 3.1 spec covering every endpoint, request/response schemas, and all documented error responses.
- Every endpoint's docs must list **every possible status code** it can return (not just the happy path) — this is essential since QA engineers will use this doc as their test-case source of truth.
- Auto-generate from Zod schemas where the chosen library supports it (`@hono/zod-openapi`); otherwise hand-author `openapi.yaml` and keep it in sync manually, with a checklist in the README reminding future changes to update it.

---

## 8. Non-Functional Requirements

### 8.1 Rate limiting

- Apply rate limiting per authenticated user (or per IP for unauthenticated `/auth/*` endpoints): **100 requests per minute** general limit, **5 requests per minute** on `/auth/login` and `/auth/register` specifically.
- On exceeding the limit, return `429 Too Many Requests` with a `Retry-After` header (seconds).
- Since Render/Hono doesn't provide this out of the box, implement via an in-memory or Redis-backed token bucket. For v1, an in-memory implementation is acceptable (single-instance deployment), but document this as a known limitation if the service is ever scaled horizontally (in-memory rate limits don't share state across instances).

### 8.2 Standard error shape

Every error response, across every endpoint, must use this exact shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable summary",
    "details": [
      { "field": "date_of_birth", "issue": "must be a date in the past" }
    ]
  }
}
```

`details` is optional/nullable for errors that aren't field-specific (e.g., `403`, `404`, `429`).

Standard `code` values to implement consistently:
| HTTP status | code |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 423 | `LOCKED` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |

This consistency is itself a QA target — see §10 for where one endpoint deliberately breaks this contract.

### 8.3 Idempotency

- `POST /appointments` and `PATCH /patients/:id/consent` must support an optional `Idempotency-Key` header. If a request with the same key + same authenticated user is retried within 24 hours, return the original response (with the original status code) rather than creating a duplicate resource.
- Store idempotency keys + cached responses in a dedicated `idempotency_keys` table (`key`, `user_id`, `response_status`, `response_body`, `created_at`), expiring after 24 hours.

### 8.4 Logging

- Structured JSON logging (not audit logs — this is operational/application logging) for every request: method, path, status, duration_ms, user_id (if authenticated).
- Do not log request/response bodies containing PII (patient data) at the operational log level — that's what `audit_logs` is for, and operational logs shouldn't duplicate PII storage.

### 8.5 Environment separation

See §9. No production credentials, secrets, or data should ever be reachable from staging or vice versa.

---

## 9. Environments & Deployment

Two environments: **staging** and **production**.

### 9.1 Branch strategy

- `main` branch → auto-deploys to **staging** on every push.
- `prod` branch → auto-deploys to **production**. Promotion to production happens via merging `main` → `prod` manually (no automatic promotion).

### 9.2 Infrastructure per environment

| Component          | Staging                                                                                                     | Production                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Render Web Service | `healthchart-staging`                                                                                       | `healthchart-prod`                                                                                                              |
| Supabase project   | Separate Supabase project (staging)                                                                         | Separate Supabase project (production)                                                                                          |
| Env vars           | Own `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, etc., scoped to Render's staging environment | Own set, scoped to Render's production environment, marked as a protected environment in Render (admin-only access)             |
| Seed data          | Freely reseedable synthetic data (see §11)                                                                  | Should remain empty or contain only minimal smoke-test fixtures — production is not meant for QA regression testing, staging is |

### 9.3 Render configuration

- Use a single `render.yaml` Blueprint with environment-specific values templated via Render's environment groups, or two separate service definitions — implementer's choice, document whichever is chosen.
- Enable Render's private network isolation between the staging and production environments so they cannot reach each other's internal resources.
- Do not enable Preview Environments for production. Preview Environments (per-PR) may optionally be enabled against staging-equivalent config for extra credit but are not required for v1.

### 9.4 Domain/naming

- Product name: **HealthChart** (used in API titles, docs, README — no domain purchase required per current scope).

---

## 10. Intentionally Planted Bugs (QA Answer Key)

This is the differentiating feature of the project: a documented set of bugs deliberately built in so a thorough QA pass should be able to find them. **This section must be implemented as described** (i.e., the bugs must actually exist in the code) but kept in a separate internal doc (`BUGS.md`, not part of public `/docs`) so it can function as an answer key without spoiling the exercise for whoever is doing the testing.

| #   | Category                                   | Description                                                                                                                                                                                                                                                                                                                                            | Where                         |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| 1   | Authorization consistency                  | `GET /patients/:id` returns `404` (not `403`) when a `provider` requests a patient not assigned to them, inconsistent with the rest of the API's `403`-for-authz-violation convention documented in §3.1. This lets a QA engineer probe for enumeration/information-disclosure differences between endpoints.                                          | `GET /patients/:id` handler   |
| 2   | Race condition                             | The appointment double-booking check on `POST /appointments` intentionally uses a check-then-insert pattern **without** a DB-level exclusion constraint (contradicting §6.4's stated requirement) — so two near-simultaneous requests can both succeed and create overlapping confirmed appointments. This is the flagship concurrency-testing bug.    | `POST /appointments`          |
| 3   | Idempotency gap                            | `Idempotency-Key` is honored on `POST /appointments` but **silently ignored** on `PATCH /patients/:id/consent` despite §8.3 stating both should support it — a double-submit of a consent change is not deduplicated.                                                                                                                                  | `PATCH /patients/:id/consent` |
| 4   | Audit log silent failure                   | If writing the audit log entry throws an error, the surrounding request still returns `200`/`201` success to the caller — the audit failure is only visible in operational logs, not surfaced to the client or blocking the action. This is a deliberate "does QA verify side effects, not just response codes" test.                                  | Audit middleware (§5.4)       |
| 5   | Consent propagation delay                  | Revoking `consent_data_sharing` correctly blocks _new_ `billing_staff` reads immediately, but an already-in-flight paginated list request (`GET /patients` fetched across multiple pages) can include a patient on an earlier page that was fetched before revocation and a later page after — inconsistent snapshot isolation across paginated reads. | `GET /patients` list logic    |
| 6   | Field-level authorization gap              | `PATCH /patients/:id` as a `patient` role silently **drops** disallowed fields (e.g., an attempt to change `date_of_birth`) instead of returning `403` as specified in §6.2 — the request succeeds with `200` and only the allowed fields are applied, with no error indicating the disallowed field was rejected.                                     | `PATCH /patients/:id` handler |
| 7   | Pagination boundary inconsistency          | `limit` values above 100 are clamped silently (per §6.7) on most list endpoints, but on `GET /audit-logs` specifically, values above 100 instead return a `400 VALIDATION_ERROR` — an inconsistency between endpoints that a thorough boundary-test sweep should surface.                                                                              | `GET /audit-logs`             |
| 8   | Sensitive record leakage in error messages | `GET /records/:id` for a sensitive record type the caller lacks access to returns `403`, but the error `message` field includes the record's `title`, leaking sensitive metadata (e.g., a mental health note's title) even though access was denied.                                                                                                   | `GET /records/:id`            |
| 9   | Rate limit scope bug                       | The `/auth/login` rate limit (5/min) is keyed by IP address, but the general API rate limit (100/min) is keyed by authenticated user ID — meaning a single IP can hammer `/auth/register` (not `/auth/login`) far beyond intended limits since registration isn't covered by either bucket.                                                            | Rate limiting middleware      |
| 10  | Review immutability gap                    | `PATCH /records/:id` correctly blocks edits when `status = reviewed` for the `body` field, but does **not** block edits to the `title` field in that same state, contradicting the "immutability after review" rule in §6.5.                                                                                                                           | `PATCH /records/:id`          |

Each bug should be traceable via a code comment `// PLANTED-BUG-#<n>: see BUGS.md` at the relevant location, so future maintenance doesn't accidentally "fix" them without realizing they're intentional — and so the agent building this can verify all ten are actually present before calling the build complete.

---

## 11. Seed / Fixture Data

Provide a seed script (`npm run seed`) that populates a **staging** database with realistic synthetic data:

- 4 admin/provider/billing_staff accounts (one of each role, plus one extra provider with `sensitive_access = true` and one without, to enable sensitive-record test scenarios)
- 20 synthetic patients (use a library like `@faker-js/faker` — never real names/data)
- ~40 appointments across various statuses
- ~30 clinical records across all `record_type` values, mixed `draft`/`reviewed` status, including at least 3 `mental_health`/`substance_use` records
- A handful of pre-existing audit log entries for realism

Seed script must be idempotent (safe to re-run) and must refuse to run if `NODE_ENV=production` (hard safety check, exit non-zero with a clear message).

---

## 12. Out of Scope for v1

- Real payment/billing integration
- HL7/FHIR interoperability
- Multi-role users
- Email/SMS notifications for appointments
- File/document uploads (e.g., imaging attachments) — `imaging` record type stores text description only in v1
- Frontend UI
- Multi-tenancy (multiple clinics/organizations) — single global patient pool in v1
- `no_show` automatic status transitions (would require a scheduled job)

---

## 13. Deliverables Checklist

- [ ] Hono + TypeScript project scaffolded, deployable to Render
- [ ] Supabase schema + RLS migrations (SQL files, checked into repo under `/migrations`)
- [ ] All endpoints in §6 implemented per role matrix in §3.1
- [ ] Standard error shape (§8.2) applied everywhere
- [ ] Rate limiting (§8.1) implemented
- [ ] Idempotency support (§8.3) implemented (including the deliberate gap in bug #3)
- [ ] Audit logging middleware (§5.4) implemented (including the deliberate gap in bug #4)
- [ ] All 10 planted bugs (§10) present and documented in `BUGS.md`
- [ ] OpenAPI spec + `/docs` route
- [ ] Seed script (§11)
- [ ] `render.yaml` or equivalent two-environment Render config (§9)
- [ ] README covering: setup, environment variables required, how to run locally, how to deploy, how to run the seed script, and a pointer to `BUGS.md` for whoever "grades" the QA exercise

---

## 14. Appendix: Example Request/Response Pairs

### Create patient

```
POST /api/v1/patients
Authorization: Bearer <token>
Content-Type: application/json

{
  "first_name": "Asha",
  "last_name": "Kulkarni",
  "date_of_birth": "1990-04-12",
  "email": "asha.kulkarni@example.com",
  "phone": "+1-555-0100"
}
```

```
201 Created
{
  "id": "5f2b...",
  "first_name": "Asha",
  "last_name": "Kulkarni",
  "date_of_birth": "1990-04-12",
  "email": "asha.kulkarni@example.com",
  "phone": "+1-555-0100",
  "status": "active",
  "consent_data_sharing": false,
  "created_at": "2026-08-24T10:00:00Z",
  "updated_at": "2026-08-24T10:00:00Z"
}
```

### Validation error example

```
POST /api/v1/patients
{ "first_name": "", "date_of_birth": "2050-01-01", "email": "not-an-email" }
```

```
400 Bad Request
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request failed validation",
    "details": [
      { "field": "first_name", "issue": "must not be empty" },
      { "field": "date_of_birth", "issue": "must be a date in the past" },
      { "field": "email", "issue": "must be a valid email address" }
    ]
  }
}
```

### Forbidden example

```
GET /api/v1/records/9a11...  (sensitive record, caller lacks sensitive_access)
```

```
403 Forbidden
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this record"
  }
}
```
