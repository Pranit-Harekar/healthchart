# HealthChart - Sandbox API

**HealthChart** is a REST API for a patient appointment and records portal for a healthcare clinic. It is designed as a testing sandbox to practice and demonstrate comprehensive testing disciplines including functional testing, authorization, concurrency, compliance-flavored scenarios, and more.

## Features

- 🔐 **Multi-role authentication** (admin, provider, billing_staff, patient) via Supabase Auth
- 👥 **Patient management** with consent tracking and soft deletes
- 📅 **Appointment scheduling** with state machine and double-booking prevention
- 📋 **Clinical records** with sensitive type access controls (mental health, substance use)
- 📊 **Audit logging** for compliance scenarios
- ⚡ **Rate limiting** and idempotency support
- 🔍 **Cursor-based pagination** for all list endpoints
- 📝 **Comprehensive error handling** with standardized error shapes

## Tech Stack

- **Runtime:** Node.js 20+ with TypeScript
- **Framework:** Hono (fast, lightweight web framework)
- **Database:** PostgreSQL via Supabase
- **ORM:** Prisma 7
- **Validation:** Zod
- **Authentication:** Supabase Auth (JWT-based)
- **Deployment:** Render (Web Service)

## Database Schema

<img width="1317" height="1100" alt="Screenshot 2026-08-24 105933" src="https://github.com/user-attachments/assets/8b48684a-d042-41f9-856d-07a66903077e" />

The database consists of 6 main tables with relationships for users, patients, appointments, clinical records, audit logs, and idempotency tracking.

## Prerequisites

- Node.js 20 or higher
- PostgreSQL database (or Supabase project)
- npm or yarn

## Local Setup

### 1. Clone and install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:

- `DATABASE_URL`: PostgreSQL connection string
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (keep secret!)
- `SUPABASE_ANON_KEY`: Supabase anon key
- `JWT_SECRET`: Random secret for additional JWT operations
- `NODE_ENV`: `development` or `production`
- `PORT`: Server port (default: 3000)

### 3. Set up the database

```bash
# Generate Prisma Client
npm run db:generate

# Push schema to database (for development)
npm run db:push

# Or run migrations (for production)
npm run db:migrate
```

### 4. Apply RLS policies (defense-in-depth)

Connect to your database and run the SQL in `migrations/001_rls_policies.sql`. These policies provide database-level security in addition to application-layer authorization checks.

### 5. Seed the database (development/local only)

```bash
npm run seed
```

This creates:

- 4 test users (admin, 2 providers, billing staff)
- 20 synthetic patients
- 40 appointments
- 30 clinical records (including sensitive types)
- Sample audit log entries

**Test accounts:**

- `admin@healthchart.local / password123`
- `provider1@healthchart.local / password123` (has `sensitive_access`)
- `provider2@healthchart.local / password123` (no `sensitive_access`)
- `billing@healthchart.local / password123`

### 6. Start the development server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

Check health: `http://localhost:3000/health`

## API Documentation

### Base URL

- **Local:** `http://localhost:3000/api/v1`
- **Production:** `https://healthchart.onrender.com/api/v1`

### Authentication

All endpoints except `/auth/*` and `/health` require a JWT token:

```bash
# Register
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "full_name": "John Doe",
  "role": "patient"
}

# Login
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

# Use the access_token in subsequent requests
Authorization: Bearer <access_token>
```

### Endpoints

#### Patients

- `POST /patients` - Create patient
- `GET /patients` - List patients (paginated)
- `GET /patients/:id` - Get patient details
- `PATCH /patients/:id` - Update patient
- `DELETE /patients/:id` - Soft delete patient (admin only)
- `PATCH /patients/:id/consent` - Update data sharing consent

#### Appointments

- `POST /appointments` - Create appointment
- `GET /appointments` - List appointments (paginated)
- `GET /appointments/:id` - Get appointment details
- `PATCH /appointments/:id/confirm` - Confirm appointment
- `PATCH /appointments/:id/checkin` - Check in appointment
- `PATCH /appointments/:id/complete` - Complete appointment
- `PATCH /appointments/:id/cancel` - Cancel appointment

#### Records

- `POST /patients/:patientId/records` - Create clinical record
- `GET /patients/:patientId/records` - List patient records
- `GET /records/:id` - Get record details
- `PATCH /records/:id` - Update record (draft only)
- `PATCH /records/:id/review` - Review and finalize record

#### Audit Logs

- `GET /audit-logs` - List audit logs (admin only, paginated)

### Role Capabilities

| Action                 | admin | provider                     | billing_staff   | patient             |
| ---------------------- | ----- | ---------------------------- | --------------- | ------------------- |
| Create patient         | ✅    | ✅                           | ✅              | ❌                  |
| View any patient       | ✅    | ✅ (assigned)                | ✅ (consenting) | ❌ (self only)      |
| Create appointment     | ✅    | ✅                           | ✅              | ✅ (request only)   |
| Create clinical record | ✅    | ✅                           | ❌              | ❌                  |
| View sensitive records | ✅    | ✅ (with `sensitive_access`) | ❌              | ✅ (self, reviewed) |
| View audit logs        | ✅    | ❌                           | ❌              | ❌                  |

See [HealthChart_PRD.md](HealthChart_PRD.md) for complete role matrix and detailed specifications.

### Pagination

All list endpoints support cursor-based pagination:

```bash
GET /api/v1/patients?limit=20&cursor=<opaque_cursor>

Response:
{
  "data": [...],
  "pagination": {
    "next_cursor": "abc123...",
    "has_more": true
  }
}
```

- `limit`: Default 20, max 100 (values above 100 are clamped)
- `cursor`: Opaque pagination cursor from previous response

### Error Handling

All errors follow a consistent shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request failed validation",
    "details": [{ "field": "email", "issue": "must be a valid email address" }]
  }
}
```

Standard error codes:

- `400` - `VALIDATION_ERROR`
- `401` - `UNAUTHENTICATED`
- `403` - `FORBIDDEN`
- `404` - `NOT_FOUND`
- `409` - `CONFLICT`
- `423` - `LOCKED` (after 5 failed login attempts)
- `429` - `RATE_LIMITED`
- `500` - `INTERNAL_ERROR`

### Idempotency

The following endpoints support the `Idempotency-Key` header for safe retries:

- `POST /appointments`
- `PATCH /patients/:id/consent`

Send the same key with identical requests to receive the cached response.

## Deployment

This project uses Render with a single production environment defined in `render.yaml`.

### Deploy to Render

1. Create a Supabase project for production
2. Connect this repo to Render
3. Set up environment variables in Render dashboard
4. Push to `main` branch to deploy

### Environment Variables (Render)

Set these in the Render dashboard:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `JWT_SECRET` (auto-generated by Render)
- `NODE_ENV` (set to `production`)

## Testing

This API is designed to be tested externally with tools like:

- Postman/Newman
- REST Assured
- Playwright API testing
- k6 load testing
- curl scripts

### Test Categories to Cover

1. **Functional testing** - All CRUD operations work correctly
2. **Authorization testing** - Role matrix is enforced (see PRD §3.1)
3. **Input validation** - Boundary conditions, invalid data
4. **Concurrency testing** - Especially appointment double-booking
5. **Idempotency testing** - Retry behavior with `Idempotency-Key`
6. **Rate limiting** - Exceeding limits returns 429
7. **State machine** - Appointment status transitions
8. **Consent propagation** - Immediate effect of consent changes
9. **Sensitive record filtering** - Provider access based on `sensitive_access` flag
10. **Audit logging** - All actions are logged

### Planted Bugs

This API contains **10 intentionally planted bugs** for QA discovery exercises.

Bug categories:

- Authorization consistency
- Race conditions
- Idempotency gaps
- Audit log failures
- Consent propagation
- Field-level authorization
- Pagination inconsistencies
- Information disclosure
- Rate limit gaps
- Business logic integrity

## Project Structure

```
healthchart/
├── src/
│   ├── index.ts              # Application entry point
│   ├── lib/                  # Database, Supabase, error utilities
│   ├── middleware/           # Auth, RBAC, audit, rate limiting
│   ├── routes/               # API route handlers
│   ├── schemas/              # Zod validation schemas
│   ├── types/                # TypeScript type definitions
│   └── seeds/                # Database seed script
├── prisma/
│   └── schema.prisma         # Database schema
├── migrations/               # RLS policy SQL files
├── BUGS.md                   # Planted bugs documentation (internal)
├── HealthChart_PRD.md        # Complete product requirements
├── render.yaml               # Deployment configuration
└── README.md                 # This file
```

## Architecture Decisions

### Prisma vs Supabase Client

**Choice:** Prisma ORM for all database operations

**Rationale:**

- Type-safe queries
- Better developer experience
- Supabase only used for Auth (JWT verification)
- RLS policies enabled but primary authz is app-layer

### Authorization Strategy

**Dual-layer approach:**

- **Application layer** (primary): Middleware checks in Hono routes
- **Database layer** (defense-in-depth): Postgres RLS policies

This design is intentional to test "what if app-layer has a bug - does RLS catch it?"

### Rate Limiting

**In-memory Map-based implementation**

**Limitation:** Not horizontally scalable (single-instance only). For multi-instance deployments, migrate to Redis-backed rate limiting.

### Idempotency Storage

**Postgres table** (`idempotency_keys`) with 24-hour TTL

**Cleanup:** Manual cleanup via cron job or scheduled task (not implemented in v1)

## Known Limitations (by Design)

1. **Single-instance deployment** - Rate limiting doesn't share state across instances
2. **No preview environments** - Single production environment only
3. **No real email notifications** - Auth is password-only, no password reset flow
4. **Placeholder patient registration** - When role=patient auto-creates patient record
5. **No `no_show` automation** - Would require scheduled jobs (out of scope)

## Compliance Notes

This API models HIPAA-flavored concepts (audit trails, consent, sensitive record redaction) for **realism only**. It is **not** legally HIPAA-compliant and must never store real patient data.

## Contributing

This is a teaching/demo project. The bugs are intentional. If you discover a bug not documented in `BUGS.md`, that's a real bug - please report it!

## License

MIT License - This is a demo project for educational purposes.

## Support

For questions about the API design or testing scenarios, see [HealthChart_PRD.md](HealthChart_PRD.md) or contact Pranit Harekar.

---

**Built with ❤️ as a testing sandbox**
