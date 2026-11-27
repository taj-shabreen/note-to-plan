import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { fallbackCandidates, organize, explicitDate, validDate } from "./planning";
import { handleClaim, recoverExpired } from "./processor";
import { newId, publicRun, transaction, appendEvent } from "./store";

const workspaceId = `controlled-test-fixtures-${newId()}`;
async function fixture(notes = "Send the urgent client proposal tomorrow.") {
  await pool.query("INSERT INTO ntp_workspaces(id) VALUES($1) ON CONFLICT DO NOTHING", [workspaceId]);
  const result = await pool.query(`INSERT INTO ntp_runs(id,workspace_id,notes,timezone,reference_date,idempotency_key,status,worker_token,lease_until,started_at)
    VALUES($1,$2,$3,'Asia/Kolkata','2026-11-26',$4,'running',$5,now()+interval '60 seconds',now()) RETURNING *`,
  [newId(), workspaceId, notes, newId(), newId()]);
  return result.rows[0];
}
async function stored(id: string) {
  const run = (await pool.query("SELECT * FROM ntp_runs WHERE id=$1", [id])).rows[0];
  const events = (await pool.query("SELECT * FROM ntp_events WHERE run_id=$1 ORDER BY seq", [id])).rows;
  const tasks = (await pool.query("SELECT * FROM ntp_tasks WHERE run_id=$1", [id])).rows;
  assert.deepEqual(events.map(e => e.seq), events.map((_, i) => i + 1));
  assert.ok(events.every(e => e.timestamp instanceof Date && e.duration_ms >= 0));
  return { run, events, tasks };
}
after(async () => {
  await pool.query("DELETE FROM ntp_execution_events WHERE run_id IN (SELECT id FROM ntp_runs WHERE workspace_id=$1)", [workspaceId]);
  await pool.query("DELETE FROM ntp_events WHERE run_id IN (SELECT id FROM ntp_runs WHERE workspace_id=$1)", [workspaceId]);
  await pool.query("DELETE FROM ntp_tasks WHERE workspace_id=$1", [workspaceId]);
  await pool.query("DELETE FROM ntp_runs WHERE workspace_id=$1", [workspaceId]);
  await pool.query("DELETE FROM ntp_workspaces WHERE id=$1", [workspaceId]);
  await pool.end();
});
test("conservative dates and fallback do not invent tasks", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(explicitDate("send tomorrow", "2026-12-31"), "2027-01-01");
  assert.equal(explicitDate("send sometime next week", "2026-11-26"), null);
  assert.equal(explicitDate("send day after tomorrow", "2026-11-26"), null);
  assert.equal(explicitDate("send today or tomorrow", "2026-11-26"), null);
  assert.equal(explicitDate("send perhaps tomorrow", "2026-11-26"), null);
  assert.deepEqual(fallbackCandidates("Beautiful sunset.\nDon't send the report.\nAlready finished the report."), []);
  const notes = "Send the urgent client proposal tomorrow.";
  assert.deepEqual(organize(fallbackCandidates(notes), notes, "2026-11-26").map(t => [t.priority, t.category, t.dueDate]), [["High", "Work", "2026-11-27"]]);
});
test("AI success is atomic and immutable output survives edits and deletion", async () => {
  const f = await fixture();
  await handleClaim(f, async () => JSON.stringify({ tasks: [{ title: "Send client proposal", priority: "High", category: "Work", source: f.notes }] }));
  let state = await stored(f.id);
  assert.equal(state.run.status, "completed");
  assert.equal(state.run.method, "ai");
  assert.equal(state.tasks.length, 1);
  const snapshot = state.run.output;
  await pool.query("UPDATE ntp_tasks SET title='Changed',completed=true,due_date=NULL WHERE run_id=$1", [f.id]);
  await pool.query("DELETE FROM ntp_tasks WHERE run_id=$1", [f.id]);
  state = await stored(f.id);
  assert.deepEqual(state.run.output, snapshot);
  assert.equal(state.run.notes, f.notes);
  // Replaying/retrying a stale worker cannot write committed results twice.
  await handleClaim(f, async () => { throw new Error("Must never be called"); });
  assert.equal((await stored(f.id)).tasks.length, 0);
});
test("controlled timeout fixture records two retries then fallback honestly", async () => {
  const f = await fixture();
  let calls = 0;
  await handleClaim(f, async () => { calls++; throw Object.assign(new Error("controlled timeout fixture"), { name: "APIConnectionTimeoutError" }); }, async () => {});
  const state = await stored(f.id);
  assert.equal(calls, 3);
  assert.equal(state.run.status, "fallback");
  assert.equal(state.run.method, "fallback");
  assert.equal(state.events.filter(e => e.status === "retrying").length, 2);
  assert.equal(state.tasks.length, 1);
});
test("controlled invalid-output fixture repairs once then uses fallback", async () => {
  const f = await fixture();
  let calls = 0;
  await handleClaim(f, async () => { calls++; return '{"tasks":[{"title":"fabricated"}]}'; });
  const state = await stored(f.id);
  assert.equal(calls, 2);
  assert.equal(state.run.status, "fallback");
  assert.ok(state.events.some(e => e.stage === "repair" && e.status === "failed"));
});
test("permanent provider errors are not retried; empty content creates no fake tasks", async () => {
  const f = await fixture("The sky is blue.");
  let calls = 0;
  await handleClaim(f, async () => { calls++; throw Object.assign(new Error("controlled bad configuration fixture"), { status: 401 }); });
  const state = await stored(f.id);
  assert.equal(calls, 1);
  assert.equal(state.run.status, "no_tasks");
  assert.equal(state.run.method, "fallback");
  assert.equal(state.tasks.length, 0);
  assert.equal(state.run.notes, f.notes);
});
test("controlled transaction failure rolls back tasks and snapshot", async () => {
  const f = await fixture("Send the report.\nBuy coffee.");
  let insertCount = 0;
  // Scoped fault injection only in this direct processor test; no HTTP debug mode.
  const originals = new Map<PoolClient, PoolClient["query"]>();
  const inject = (c: PoolClient) => {
    if (originals.has(c)) return;
    const query = c.query.bind(c);
    originals.set(c, query);
    c.query = (async (...args: unknown[]) => {
      if (String(args[0]).includes("INSERT INTO ntp_tasks") && ++insertCount === 2) throw new Error("controlled persistence failure fixture");
      return (query as (...a: unknown[]) => Promise<unknown>)(...args);
    }) as typeof c.query;
  };
  const restore = (_err: Error | undefined, c: PoolClient) => {
    const original = originals.get(c);
    if (original) c.query = original;
    originals.delete(c);
  };
  pool.on("acquire", inject);
  pool.on("release", restore);
  try {
    await handleClaim(f, async () => JSON.stringify({ tasks: [
      { title: "Send report", priority: "Medium", category: "Work", source: "Send the report." },
      { title: "Buy coffee", priority: "Medium", category: "Shopping", source: "Buy coffee." },
    ] }));
  } finally {
    pool.off("acquire", inject);
    pool.off("release", restore);
    for (const [client, query] of originals) client.query = query;
  }
  const state = await stored(f.id);
  assert.equal(state.run.status, "failed");
  assert.equal(state.tasks.length, 0);
  assert.deepEqual(state.run.output, []);
  assert.equal(state.run.notes, f.notes);
  assert.ok(state.events.some(e => e.stage === "save" && e.status === "failed"));
});
test("expired lease records interruption and bounded recovery", async () => {
  const f = await fixture();
  await pool.query("UPDATE ntp_runs SET lease_until=now()-interval '1 second' WHERE id=$1", [f.id]);
  await recoverExpired();
  let state = await stored(f.id);
  assert.equal(state.run.status, "queued");
  assert.ok(state.events.some(e => e.status === "interrupted"));
  await pool.query("UPDATE ntp_runs SET status='running',recoveries=2,lease_until=now()-interval '1 second' WHERE id=$1", [f.id]);
  await recoverExpired();
  state = await stored(f.id);
  assert.equal(state.run.status, "failed");
  assert.equal(state.tasks.length, 0);
});
test("previous history is retained and new events continue its sequence", async () => {
  const f = await fixture();
  await pool.query("INSERT INTO ntp_execution_events(id,run_id,sequence,stage,status,summary) VALUES($1,$2,1,'receive','completed','Previous processor saved notes')", [newId(), f.id]);
  await transaction(async c => {
    await c.query("SELECT id FROM ntp_runs WHERE id=$1 FOR UPDATE", [f.id]);
    await appendEvent(c, f.id, "recovery", "interrupted", "Continuing previously recorded run.");
  });
  const events = (await pool.query("SELECT seq FROM ntp_events WHERE run_id=$1", [f.id])).rows;
  assert.deepEqual(events.map(e => e.seq), [2]);
  const legacy = publicRun({ ...f, reference_date: null, method: "rules" });
  assert.equal(legacy.method, "fallback");
  assert.match(String(legacy.referenceDate), /^\d{4}-\d{2}-\d{2}$/);
});
