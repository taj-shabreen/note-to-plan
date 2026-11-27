import type { ExecutionEvent, Run } from "@workspace/api-client-react";

export const MAIN_STAGES = ["receive", "validate", "extract", "structure", "repair", "fallback", "organize", "save", "finish"] as const;
export const ALL_STAGES = [...MAIN_STAGES, "recovery"];
export const TERMINAL = new Set(["completed", "fallback", "no_tasks", "failed"]);

export const STAGE_BLURB: Record<string, string> = {
  receive: "Notes accepted by the server",
  validate: "Input checked for shape and size",
  extract: "Model asked to pull tasks out",
  repair: "Malformed model output corrected",
  structure: "Tasks coerced into schema",
  organize: "Priorities and dates normalized",
  fallback: "Rule-based extraction used instead",
  save: "Tasks written to your workspace",
  finish: "Run closed and timed",
  recovery: "Interrupted run resumed or closed",
};

export type StageState = "pending" | ExecutionEvent["status"];

export interface StageView {
  stage: string;
  state: StageState;
  events: ExecutionEvent[];
  attempts: number;
  durationMs: number;
}

export function deriveStages(events: ExecutionEvent[]): Record<string, StageView> {
  const out: Record<string, StageView> = {};
  for (const s of ALL_STAGES) out[s] = { stage: s, state: "pending", events: [], attempts: 0, durationMs: 0 };
  for (const e of events) {
    const v = out[e.stage] ?? (out[e.stage] = { stage: e.stage, state: "pending", events: [], attempts: 0, durationMs: 0 });
    v.events.push(e);
    v.state = e.status;
    v.attempts = Math.max(v.attempts, e.attempt);
    v.durationMs += e.durationMs || 0;
  }
  return out;
}

export function mergeEvents(prev: ExecutionEvent[], next: ExecutionEvent[]): ExecutionEvent[] {
  const map = new Map<number, ExecutionEvent>();
  for (const e of prev) map.set(e.seq, e);
  for (const e of next) map.set(e.seq, e);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

export const shortId = (id: string) => id.slice(0, 6);

export function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDue(date: string | null) {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
}

export function localDateString(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const RUN_STATUS_LABEL: Record<Run["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  fallback: "Fallback",
  no_tasks: "No tasks",
  failed: "Failed",
};

export function statusTone(s: string) {
  switch (s) {
    case "succeeded":
    case "completed":
      return "text-[hsl(162_42%_30%)]";
    case "failed":
    case "interrupted":
      return "text-destructive";
    case "retrying":
    case "fallback":
      return "text-accent";
    case "running":
    case "started":
    case "queued":
      return "text-primary";
    default:
      return "text-muted-foreground";
  }
}

export function errorInfo(err: unknown): { message: string; status: number | null } {
  const e = err as { status?: number; data?: { error?: string } | null; message?: string };
  const status = typeof e?.status === "number" ? e.status : null;
  const message = e?.data?.error || e?.message || "Something went wrong";
  return { message, status };
}
