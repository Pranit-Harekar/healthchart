import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { faker } from "@faker-js/faker";
import { supabaseAdmin } from "../lib/supabase.js";

// Create connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create adapter
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

// Safety check
if (process.env.NODE_ENV === "production") {
  console.error("❌ Cannot run seed script in production environment!");
  process.exit(1);
}

async function main() {
  console.log("🌱 Starting seed...");

  // Clear existing data (in reverse order of dependencies)
  console.log("Clearing existing data...");
  await prisma.auditLog.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.record.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.profile.deleteMany();

  console.log("Creating users and profiles...");

  // Create admin user
  const { data: adminAuth } = await supabaseAdmin.auth.admin.createUser({
    email: "admin@healthchart.local",
    password: "password123",
    email_confirm: true,
  });

  await prisma.profile.create({
    data: {
      id: adminAuth!.user!.id,
      role: "admin",
      full_name: "Admin User",
      sensitive_access: true,
    },
  });
  console.log("✓ Created admin user (admin@healthchart.local / password123)");

  // Create provider with sensitive access
  const { data: provider1Auth } = await supabaseAdmin.auth.admin.createUser({
    email: "provider1@healthchart.local",
    password: "password123",
    email_confirm: true,
  });

  const provider1 = await prisma.profile.create({
    data: {
      id: provider1Auth!.user!.id,
      role: "provider",
      full_name: "Dr. Sarah Johnson",
      sensitive_access: true,
    },
  });
  console.log(
    "✓ Created provider with sensitive access (provider1@healthchart.local / password123)",
  );

  // Create provider without sensitive access
  const { data: provider2Auth } = await supabaseAdmin.auth.admin.createUser({
    email: "provider2@healthchart.local",
    password: "password123",
    email_confirm: true,
  });

  const provider2 = await prisma.profile.create({
    data: {
      id: provider2Auth!.user!.id,
      role: "provider",
      full_name: "Dr. Michael Chen",
      sensitive_access: false,
    },
  });
  console.log(
    "✓ Created provider without sensitive access (provider2@healthchart.local / password123)",
  );

  // Create billing staff
  const { data: billingAuth } = await supabaseAdmin.auth.admin.createUser({
    email: "billing@healthchart.local",
    password: "password123",
    email_confirm: true,
  });

  await prisma.profile.create({
    data: {
      id: billingAuth!.user!.id,
      role: "billing_staff",
      full_name: "Jessica Martinez",
      sensitive_access: false,
    },
  });
  console.log(
    "✓ Created billing staff (billing@healthchart.local / password123)",
  );

  console.log("\nCreating patients...");
  const patients = [];
  for (let i = 0; i < 20; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const patient = await prisma.patient.create({
      data: {
        first_name: firstName,
        last_name: lastName,
        date_of_birth: faker.date.birthdate({ min: 18, max: 80, mode: "age" }),
        email: faker.internet.email({ firstName, lastName }).toLowerCase(),
        phone: faker.phone.number(),
        address: {
          line1: faker.location.streetAddress(),
          city: faker.location.city(),
          state: faker.location.state({ abbreviated: true }),
          postal_code: faker.location.zipCode(),
          country: "USA",
        },
        assigned_provider_id: i % 2 === 0 ? provider1.id : provider2.id,
        consent_data_sharing: i < 15, // 15 consenting, 5 not consenting
        status: "active",
      },
    });
    patients.push(patient);
  }
  console.log(`✓ Created ${patients.length} patients`);

  console.log("\nCreating appointments...");
  const appointments = [];
  const statuses = [
    "requested",
    "confirmed",
    "checked_in",
    "completed",
    "cancelled",
  ];

  for (let i = 0; i < 40; i++) {
    const patient = patients[i % patients.length];
    const providerId = patient.assigned_provider_id!;
    const startTime = faker.date.future();
    const endTime = new Date(
      startTime.getTime() + (30 + Math.random() * 90) * 60 * 1000,
    ); // 30-120 min

    const appointment = await prisma.appointment.create({
      data: {
        patient_id: patient.id,
        provider_id: providerId,
        start_time: startTime,
        end_time: endTime,
        status: statuses[Math.floor(Math.random() * statuses.length)] as any,
        reason: i % 3 === 0 ? faker.lorem.sentence() : undefined,
        created_by: providerId,
      },
    });
    appointments.push(appointment);
  }
  console.log(`✓ Created ${appointments.length} appointments`);

  console.log("\nCreating clinical records...");
  const recordTypes = [
    "visit_note",
    "lab_result",
    "imaging",
    "vaccination",
    "mental_health",
    "substance_use",
    "general",
  ];

  for (let i = 0; i < 30; i++) {
    const patient = patients[i % patients.length];
    const providerId = patient.assigned_provider_id!;
    const recordType = recordTypes[i % recordTypes.length] as any;
    const isDraft = i % 4 === 0; // 25% draft, 75% reviewed

    const record = await prisma.record.create({
      data: {
        patient_id: patient.id,
        author_id: providerId,
        record_type: recordType,
        title: faker.lorem.sentence(),
        body: faker.lorem.paragraphs(2),
        status: isDraft ? "draft" : "reviewed",
        reviewed_at: isDraft ? null : faker.date.past(),
        reviewed_by: isDraft ? null : providerId,
      },
    });
  }
  console.log(`✓ Created 30 records (including sensitive types)`);

  console.log("\nCreating sample audit logs...");
  for (let i = 0; i < 10; i++) {
    await prisma.auditLog.create({
      data: {
        actor_id: i % 2 === 0 ? provider1.id : provider2.id,
        actor_role: "provider",
        action: i % 2 === 0 ? "patient.view" : "record.create",
        resource_type: i % 2 === 0 ? "patient" : "record",
        resource_id: patients[i % patients.length].id,
        patient_id: patients[i % patients.length].id,
        ip_address: faker.internet.ipv4(),
      },
    });
  }
  console.log("✓ Created 10 sample audit log entries");

  console.log("\n✅ Seed completed successfully!");
  console.log("\nTest accounts:");
  console.log("  Admin:          admin@healthchart.local / password123");
  console.log(
    "  Provider 1:     provider1@healthchart.local / password123 (has sensitive_access)",
  );
  console.log(
    "  Provider 2:     provider2@healthchart.local / password123 (no sensitive_access)",
  );
  console.log("  Billing Staff:  billing@healthchart.local / password123");
  console.log("\nData summary:");
  console.log(
    `  - ${patients.length} patients (15 consenting, 5 not consenting)`,
  );
  console.log(`  - ${appointments.length} appointments across all statuses`);
  console.log(
    "  - 30 clinical records (mix of types including mental_health/substance_use)",
  );
  console.log("  - 10 sample audit log entries");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
