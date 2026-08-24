import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { swaggerUI } from "@hono/swagger-ui";
import type { Variables } from "./types/context.js";
import { AppError, ErrorCodes } from "./lib/errors.js";

// Import routes
import auth from "./routes/auth.js";
import patients from "./routes/patients.js";
import appointments from "./routes/appointments.js";
import records from "./routes/records.js";
import audit from "./routes/audit.js";

const app = new Hono<{ Variables: Variables }>();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Structured logging for requests
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const user = c.get("user");

  console.log(
    JSON.stringify({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: duration,
      user_id: user?.id || null,
    }),
  );
});

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// OpenAPI/Swagger documentation
app.get("/swagger", swaggerUI({ url: "/openapi.json" }));

app.get("/openapi.json", (c) => {
  return c.json({
    openapi: "3.0.0",
    info: {
      title: "HealthChart QA Testing API",
      version: "1.0.0",
      description:
        "Healthcare API simulation with intentionally planted bugs for QA testing exercises",
    },
    servers: [
      {
        url: `http://localhost:${port}`,
        description: "Development server",
      },
    ],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Server is healthy",
            },
          },
        },
      },
      "/api/v1/auth/register": {
        post: {
          summary: "Register a new user",
          tags: ["Authentication"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password", "role"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string", minLength: 8 },
                    role: {
                      type: "string",
                      enum: ["admin", "provider", "billing_staff", "patient"],
                    },
                    name: { type: "string" },
                    sensitive_access: { type: "boolean" },
                    linked_patient_id: { type: "string", format: "uuid" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "User registered successfully" },
            "400": { description: "Validation error" },
            "409": { description: "User already exists" },
          },
        },
      },
      "/api/v1/auth/login": {
        post: {
          summary: "Login",
          tags: ["Authentication"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Login successful, returns access token" },
            "401": { description: "Invalid credentials" },
            "403": { description: "Account locked" },
          },
        },
      },
      "/api/v1/patients": {
        get: {
          summary: "List patients",
          tags: ["Patients"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10, maximum: 100 },
            },
            { name: "consenting", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": { description: "List of patients" },
            "401": { description: "Unauthorized" },
          },
        },
        post: {
          summary: "Create patient",
          tags: ["Patients"],
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Patient created" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        },
      },
      "/api/v1/patients/{id}/consent": {
        post: {
          summary: "Update patient consent",
          tags: ["Patients"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Consent updated" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Patient not found" },
          },
        },
      },
      "/api/v1/appointments": {
        get: {
          summary: "List appointments",
          tags: ["Appointments"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10, maximum: 100 },
            },
            { name: "status", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "List of appointments" },
            "401": { description: "Unauthorized" },
          },
        },
        post: {
          summary: "Create appointment",
          tags: ["Appointments"],
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Appointment created" },
            "401": { description: "Unauthorized" },
            "409": { description: "Conflict - double booking" },
          },
        },
      },
      "/api/v1/records": {
        get: {
          summary: "List clinical records",
          tags: ["Records"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10, maximum: 100 },
            },
            {
              name: "patient_id",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
            { name: "record_type", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "List of records" },
            "401": { description: "Unauthorized" },
          },
        },
        post: {
          summary: "Create clinical record",
          tags: ["Records"],
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Record created" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        },
      },
      "/api/v1/audit-logs": {
        get: {
          summary: "List audit logs (admin only)",
          tags: ["Audit"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10, maximum: 100 },
            },
          ],
          responses: {
            "200": { description: "List of audit logs" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden - admin only" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  });
});

// API routes
app.route("/api/v1/auth", auth);
app.route("/api/v1/patients", patients);
app.route("/api/v1/appointments", appointments);
app.route("/api/v1/records", records);
app.route("/api/v1/audit-logs", audit);

// Error handler
app.onError((err, c) => {
  console.error("Error:", err);

  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.statusCode as any,
    );
  }

  // Validation errors from Zod
  if (err.name === "ZodError") {
    return c.json(
      {
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: "Request failed validation",
          details:
            (err as any).issues?.map((issue: any) => ({
              field: issue.path.join("."),
              issue: issue.message,
            })) || [],
        },
      },
      400,
    );
  }

  return c.json(
    {
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Internal server error",
      },
    },
    500,
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: ErrorCodes.NOT_FOUND,
        message: "Route not found",
      },
    },
    404,
  );
});

const port = parseInt(process.env.PORT || "3000");

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(
      `🚀 HealthChart API server running on http://localhost:${info.port}`,
    );
    console.log(`📊 Health check: http://localhost:${info.port}/health`);
    console.log(`� API docs: http://localhost:${info.port}/swagger`);
    console.log(`�🔐 Environment: ${process.env.NODE_ENV || "development"}`);
  },
);
