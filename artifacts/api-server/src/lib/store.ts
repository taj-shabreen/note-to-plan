import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const result = await fn(c); await c.query("COMMIT"); return result; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}

export function camel(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, s: string) => s.toUpperCase()), v instanceof Date ? v.toISOString() : v]));
}
export function publicRun(row: Record<string, unknown>) {
  const { workspaceId, idempotencyKey, workerToken, leaseUntil, recoveries, aiAttempts, attempts, ...safe } = camel(row);
  const referenceDate = safe.referenceDate ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: String(safe.timezone), year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(String(safe.createdAt)));
  return { ...safe, referenceDate, method: safe.method === "rules" ? "fallback" : safe.method };
}
export const newId = () => randomUUID();

export async function appendEvent(c: PoolClient, id: string, stage: string, status: string, summary: string, durationMs = 0, attempt = 1, details = "") {
  // Caller holds the run row lock: sequence assignment and append are atomic.
  await c.query(`INSERT INTO ntp_events (run_id,seq,stage,status,summary,duration_ms,attempt,details)
    SELECT $1,COALESCE(MAX(seq),0)+1,$2,$3,$4,$5,$6,$7 FROM (
      SELECT seq FROM ntp_events WHERE run_id=$1
      UNION ALL SELECT sequence AS seq FROM ntp_execution_events WHERE run_id=$1
    ) history`,
  [id, stage, status, summary, Math.max(0, Math.round(durationMs)), attempt, details]);
}
