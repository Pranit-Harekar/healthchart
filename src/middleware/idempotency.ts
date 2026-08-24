import type { Context, Next } from "hono";
import type { Variables } from "../types/context.js";
import { prisma } from "../lib/db.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function idempotent() {
  return async (c: Context<{ Variables: Variables }>, next: Next) => {
    const idempotencyKey = c.req.header("Idempotency-Key");

    if (!idempotencyKey) {
      await next();
      return;
    }

    const user = c.get("user");
    if (!user) {
      await next();
      return;
    }

    // Check for existing response
    const existing = await prisma.idempotencyKey.findUnique({
      where: {
        key_user_id: {
          key: idempotencyKey,
          user_id: user.id,
        },
      },
    });

    if (existing) {
      // Return cached response
      return c.json(
        existing.response_body as any,
        existing.response_status as any,
      );
    }

    // Execute the request
    await next();

    // Cache the response
    const response = await c.res.clone().json();
    const status = c.res.status;

    try {
      await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          user_id: user.id,
          response_status: status,
          response_body: response,
        },
      });
    } catch (error) {
      // Ignore duplicate key errors (race condition)
      console.error("Failed to store idempotency key:", error);
    }
  };
}

// Clean up expired idempotency keys periodically
export async function cleanupIdempotencyKeys() {
  const expiredTime = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
  await prisma.idempotencyKey.deleteMany({
    where: {
      created_at: {
        lt: expiredTime,
      },
    },
  });
}
