import { Router, type IRouter } from "express";
import cookieParser from "cookie-parser";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import {
  CreateRunBody, CreateRunResponse, ListRunsResponse, GetRunParams, GetRunResponse,
  GetRunEventsParams, GetRunEventsQueryParams, GetRunEventsResponse,
  ListTasksResponse, UpdateTaskParams, UpdateTaskBody, UpdateTaskResponse,
  DeleteTaskParams, GetWorkspaceSummaryResponse,
} from "@workspace/api-zod";
import { appendEvent, camel, newId, publicRun, transaction } from "../lib/store";
import { validDate } from "../lib/planning";

const router: IRouter = Router();
router.use(cookieParser());
router.use(async (req, res, next) => {
  if (!/^\/(?:tasks|runs|workspace|summary)(?:\/|$)/.test(req.path)) { next(); return; }
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    const expectedHost = req.get("x-forwarded-host") ?? req.get("host");
    if (req.get("sec-fetch-site") === "cross-site" || (origin && new URL(origin).host !== expectedHost)) {
      res.status(403).json({ error: "Cross-site workspace changes are not allowed." }); return;
    }
    if (!req.is("application/json") && req.method !== "DELETE") {
      res.status(415).json({ error: "Use application/json." }); return;
    }
  }
  try {
    const existing = req.cookies?.ntp_session ?? req.cookies?.ntp_workspace;
    const token = typeof existing === "string" && /^[a-f0-9]{64}$/.test(existing) ? existing : randomBytes(32).toString("hex");
    const workspaceId = createHash("sha256").update(token).digest("hex");
    await pool.query("INSERT INTO ntp_workspaces(id) VALUES($1) ON CONFLICT DO NOTHING", [workspaceId]);
    if (token !== req.cookies?.ntp_session) res.cookie("ntp_session", token, {
      httpOnly: true, sameSite: "lax", secure: req.secure || req.get("x-forwarded-proto") === "https",
      maxAge: 365 * 24 * 60 * 60 * 1000, path: "/",
    });
    res.locals.workspaceId = workspaceId;
    next();
  } catch {
    res.status(503).json({ error: "Storage is unavailable. A new submission has not been saved; your device draft is unchanged. Retry when connected." });
  }
});

router.get(["/workspace/summary", "/summary"], async (_req, res): Promise<void> => {
  const w = res.locals.workspaceId;
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM ntp_tasks WHERE workspace_id=$1) AS "totalTasks",
    (SELECT count(*)::int FROM ntp_tasks WHERE workspace_id=$1 AND completed) AS "completedTasks",
    (SELECT count(*)::int FROM ntp_tasks WHERE workspace_id=$1 AND NOT completed AND priority='High') AS "highPriorityTasks",
    (SELECT count(*)::int FROM ntp_runs WHERE workspace_id=$1) AS "totalRuns",
    (SELECT count(*)::int FROM ntp_runs WHERE workspace_id=$1 AND status IN ('completed','fallback','no_tasks')) AS "successRuns",
    (SELECT COALESCE(round(avg(duration_ms)),0)::int FROM ntp_runs WHERE workspace_id=$1 AND duration_ms IS NOT NULL) AS "averageDurationMs",
    (SELECT id FROM ntp_runs WHERE workspace_id=$1 AND status IN ('running','queued') ORDER BY created_at LIMIT 1) AS "activeRunId"`, [w]);
  res.json(GetWorkspaceSummaryResponse.parse(result.rows[0]));
});
router.get("/runs", async (_req, res): Promise<void> => {
  const result = await pool.query("SELECT * FROM ntp_runs WHERE workspace_id=$1 ORDER BY created_at DESC", [res.locals.workspaceId]);
  res.json(ListRunsResponse.parse(result.rows.map(publicRun)));
});
router.post("/runs", async (req, res): Promise<void> => {
  const parsed = CreateRunBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter 1–20,000 characters of notes, a valid date/timezone and a request key." }); return; }
  const b = parsed.data;
  if (!b.notes.trim() || !validDate(b.referenceDate)) { res.status(400).json({ error: "Notes cannot be blank; reference date must be a real YYYY-MM-DD date." }); return; }
  try { new Intl.DateTimeFormat("en", { timeZone: b.timezone }).format(); }
  catch { res.status(400).json({ error: "Choose a valid IANA timezone." }); return; }
  const w = res.locals.workspaceId;
  const result = await transaction(async c => {
    // Workspace lock serializes active-run limits and concurrent duplicate submissions.
    await c.query("SELECT id FROM ntp_workspaces WHERE id=$1 FOR UPDATE", [w]);
    const old = await c.query("SELECT * FROM ntp_runs WHERE workspace_id=$1 AND idempotency_key=$2", [w, b.idempotencyKey]);
    if (old.rowCount) {
      const r = old.rows[0];
      if (r.notes !== b.notes || r.reference_date !== b.referenceDate || r.timezone !== b.timezone || r.parent_run_id !== (b.parentRunId ?? null)) {
        return { conflict: "This request key was already used for different notes. Start a new submission." };
      }
      return { run: r };
    }
    if (b.parentRunId) {
      const parent = await c.query("SELECT id FROM ntp_runs WHERE id=$1 AND workspace_id=$2", [b.parentRunId, w]);
      if (!parent.rowCount) return { conflict: "The original run does not exist in this workspace." };
    }
    const active = await c.query("SELECT id FROM ntp_runs WHERE workspace_id=$1 AND status IN ('queued','running') LIMIT 1", [w]);
    if (active.rowCount) return { conflict: "Another run is still processing. Wait for it to finish before starting another." };
    const recent = await c.query("SELECT count(*)::int AS count FROM ntp_runs WHERE workspace_id=$1 AND created_at>now()-interval '1 minute'", [w]);
    if (recent.rows[0].count >= 5) return { limited: true };
    const id = newId();
    const started = performance.now();
    const saved = await c.query(`INSERT INTO ntp_runs(id,workspace_id,notes,timezone,reference_date,parent_run_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, w, b.notes, b.timezone, b.referenceDate, b.parentRunId ?? null, b.idempotencyKey]);
    await appendEvent(c, id, "receive", "succeeded", "Original notes durably saved; run queued for processing.", performance.now() - started, 1, `${b.notes.length} characters. Original input is stored separately from generated tasks.`);
    return { run: saved.rows[0] };
  });
  if (result.limited) { res.status(429).json({ error: "You have started five runs in a minute. Please wait before starting another." }); return; }
  if (result.conflict) { res.status(409).json({ error: result.conflict }); return; }
  res.status(202).json(CreateRunResponse.parse(publicRun(result.run)));
});
router.get("/runs/:id", async (req, res): Promise<void> => {
  const params = GetRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid run." }); return; }
  const result = await pool.query("SELECT * FROM ntp_runs WHERE id=$1 AND workspace_id=$2", [params.data.id, res.locals.workspaceId]);
  if (!result.rowCount) { res.status(404).json({ error: "Run not found." }); return; }
  res.json(GetRunResponse.parse(publicRun(result.rows[0])));
});
router.get("/runs/:id/events", async (req, res): Promise<void> => {
  const params = GetRunEventsParams.safeParse(req.params);
  const query = GetRunEventsQueryParams.safeParse(req.query);
  if (!params.success || !query.success) { res.status(400).json({ error: "Invalid event cursor." }); return; }
  // One consistent snapshot avoids exposing terminal status before the final events.
  const result = await pool.query(`SELECT r.status,
    COALESCE((SELECT json_agg(e ORDER BY e.seq) FROM (
      SELECT run_id,seq,stage,status,attempt,timestamp,duration_ms,summary,details FROM ntp_events WHERE run_id=r.id
      UNION ALL
      SELECT run_id,sequence AS seq,CASE WHEN stage='check' THEN 'structure' ELSE stage END AS stage,
        CASE WHEN status='completed' THEN 'succeeded' ELSE status END AS status,
        attempt,timestamp,COALESCE(duration_ms,0),summary,'Recorded by the previous processor; original timestamps and summaries preserved.' AS details
        FROM ntp_execution_events WHERE run_id=r.id
    ) e WHERE e.seq>$3),'[]') AS events
    FROM ntp_runs r WHERE r.id=$1 AND r.workspace_id=$2`, [params.data.id, res.locals.workspaceId, query.data.after ?? 0]);
  if (!result.rowCount) { res.status(404).json({ error: "Run not found." }); return; }
  const events = (result.rows[0].events as Record<string, unknown>[]).map(camel);
  res.json(GetRunEventsResponse.parse({ events, status: result.rows[0].status, cursor: events.length ? events[events.length - 1]!.seq : query.data.after ?? 0 }));
});
router.get("/tasks", async (_req, res): Promise<void> => {
  const result = await pool.query("SELECT *,to_char(due_date,'YYYY-MM-DD') AS due_date FROM ntp_tasks WHERE workspace_id=$1 ORDER BY created_at DESC,ordinal", [res.locals.workspaceId]);
  res.json(ListTasksResponse.parse(result.rows.map(camel)));
});
router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  const body = UpdateTaskBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid task fields." }); return; }
  const b = body.data;
  if ((b.title !== undefined && !b.title.trim()) || (b.category !== undefined && !b.category.trim()) || (b.dueDate != null && !validDate(b.dueDate))) {
    res.status(400).json({ error: "Title and category cannot be blank; use a real YYYY-MM-DD due date." }); return;
  }
  const columns: Record<string, string> = { title: "title", priority: "priority", category: "category", completed: "completed", dueDate: "due_date" };
  const entries = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!entries.length) { res.status(400).json({ error: "No changes provided." }); return; }
  const sets = entries.map(([k], i) => `${columns[k]}=$${i + 3}`);
  const result = await pool.query(`UPDATE ntp_tasks SET ${sets.join(",")},updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *,to_char(due_date,'YYYY-MM-DD') AS due_date`,
    [params.data.id, res.locals.workspaceId, ...entries.map(([k, v]) => k === "title" || k === "category" ? String(v).trim() : v)]);
  if (!result.rowCount) { res.status(404).json({ error: "Task not found." }); return; }
  res.json(UpdateTaskResponse.parse(camel(result.rows[0])));
});
router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid task." }); return; }
  const result = await pool.query("DELETE FROM ntp_tasks WHERE id=$1 AND workspace_id=$2 RETURNING id", [params.data.id, res.locals.workspaceId]);
  if (!result.rowCount) { res.status(404).json({ error: "Task not found." }); return; }
  res.sendStatus(204);
});
export default router;
