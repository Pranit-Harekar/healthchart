import type { Context, Next } from "hono";
import type { Variables } from "../types/context.js";
import { createError, ErrorCodes } from "../lib/errors.js";

interface RateLimitStore {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitStore>();

// Clean up expired entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  },
  5 * 60 * 1000,
);

export function rateLimit(
  maxRequests: number,
  windowMs: number,
  keyFn: (c: Context) => string,
) {
  return async (c: Context<{ Variables: Variables }>, next: Next) => {
    const key = keyFn(c);
    const now = Date.now();

    const existing = rateLimitStore.get(key);

    if (existing) {
      if (existing.resetAt < now) {
        // Window expired, reset
        rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      } else if (existing.count >= maxRequests) {
        // Rate limit exceeded
        const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
        c.header("Retry-After", retryAfter.toString());
        throw createError(429, ErrorCodes.RATE_LIMITED, "Too many requests");
      } else {
        // Increment counter
        existing.count++;
      }
    } else {
      // First request in window
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    }

    await next();
  };
}

// General API rate limit: 100 requests per minute per user
export const apiRateLimit = rateLimit(100, 60 * 1000, (c) => {
  const user = c.get("user");
  return user
    ? `api:${user.id}`
    : `api:anonymous:${c.req.header("x-forwarded-for") || "unknown"}`;
});

// Auth login rate limit: 5 requests per minute per IP
export const authLoginRateLimit = rateLimit(
  5,
  60 * 1000,
  (c) =>
    `auth:login:${c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown"}`,
);

// PLANTED-BUG-#9: /auth/register is not covered by any rate limit
// The authLoginRateLimit only covers /auth/login, so registration can be hammered
