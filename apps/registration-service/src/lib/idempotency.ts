import { pg } from "../db/client.js";

type CachedResponse = {
  responseStatus: number;
  responseBody: unknown;
};

type IdempotencyRow = {
  status: string;
  response_status: number | null;
  response_body: string | null;
};

/**
 * Wrap an async handler with HTTP idempotency semantics.
 *
 * Flow:
 *   1. No key provided → call handler directly (no caching)
 *   2. Key found, status = 'done'       → return cached response
 *   3. Key found, status = 'processing' → return 409 (request in flight)
 *   4. Key not found → claim it, call handler, cache result
 *
 * The caller is responsible for returning `{ status, body }` from the handler.
 * On error the key stays 'processing'; a separate TTL job can clean those up.
 */
export async function withIdempotency(
  key: string | undefined,
  handler: () => Promise<CachedResponse>,
): Promise<CachedResponse> {
  if (!key) return handler();

  // ── Check for existing key ──────────────────────────────────────────────
  const [existing] = await pg<[IdempotencyRow?]>`
    SELECT status, response_status, response_body
    FROM   idempotency_keys
    WHERE  key = ${key}
  `;

  if (existing) {
    if (existing.status === "done" && existing.response_status !== null && existing.response_body !== null) {
      return {
        responseStatus: existing.response_status,
        responseBody: JSON.parse(existing.response_body) as unknown,
      };
    }
    // Another request is currently processing this key
    return {
      responseStatus: 409,
      responseBody: { error: "Request with this Idempotency-Key is already being processed" },
    };
  }

  // ── Claim the key ───────────────────────────────────────────────────────
  // ON CONFLICT DO NOTHING handles the race between two simultaneous requests:
  // the second insert silently fails and its SELECT above returns the existing row.
  await pg`
    INSERT INTO idempotency_keys (key, status)
    VALUES (${key}, 'processing')
    ON CONFLICT (key) DO NOTHING
  `;

  // ── Execute the handler ─────────────────────────────────────────────────
  let result: CachedResponse;
  try {
    result = await handler();
  } catch (err) {
    // Leave status = 'processing' so retries still see the conflict.
    // A TTL cleanup job should periodically delete stale 'processing' rows.
    throw err;
  }

  // ── Cache the result ────────────────────────────────────────────────────
  await pg`
    UPDATE idempotency_keys
    SET    status          = 'done',
           response_status = ${result.responseStatus},
           response_body   = ${JSON.stringify(result.responseBody)}
    WHERE  key = ${key}
  `;

  return result;
}

/** PostgreSQL error code for unique_violation */
export const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
