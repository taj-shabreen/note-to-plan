import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CloudOff, FileText, GitBranch, Info, Loader2, RefreshCw, Sparkles, WifiOff, X } from "lucide-react";
import {
  getGetRunQueryKey,
  getGetWorkspaceSummaryQueryKey,
  getListRunsQueryKey,
  getListTasksQueryKey,
  useCreateRun,
  useGetRun,
  useGetWorkspaceSummary,
  useListRuns,
  type Run,
} from "@workspace/api-client-react";
import { ExecutionPanel } from "@/components/execution-panel";
import { TasksPanel } from "@/components/tasks-panel";
import { useOnline, useRunStream } from "@/hooks/use-run-stream";
import { useToast } from "@/hooks/use-toast";
import { RUN_STATUS_LABEL, TERMINAL, errorInfo, fmtDateTime, fmtDue, fmtMs, localDateString, shortId, statusTone } from "@/lib/run-utils";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "ntp.draft.v1";
const PENDING_KEY = "ntp.pending.v1";
const NOTICE_KEY = "ntp.notice.v1";
const MAX = 20000;

const SAMPLE = `Brain dump
- Send the urgent client proposal tomorrow.
- Buy groceries today: rice, tomatoes and coffee.
- Book a dentist appointment.
- Read the design article whenever there is time, low priority.
- Review the project report.
The weather was lovely this morning.`;

interface Pending { key: string; notes: string; parentRunId: string | null; timezone: string; referenceDate: string }

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string | null): boolean {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); return true; }
  catch { return false; }
}
function readPending(): Pending | null {
  try { return JSON.parse(readLocal(PENDING_KEY) || "null"); } catch { return null; }
}
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function StatusStamp({ status, method }: { status: Run["status"]; method?: Run["method"] }) {
  return (
    <span className={cn("stamp", statusTone(status))} data-testid="status-run">
      {status === "running" || status === "queued" ? <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {RUN_STATUS_LABEL[status]}
      {method && method !== "pending" && status !== "failed" ? <span className="opacity-70">· {method}</span> : null}
    </span>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const online = useOnline();

  const summary = useGetWorkspaceSummary({ query: { queryKey: getGetWorkspaceSummaryQueryKey(), retry: 2 } });
  const ready = summary.isSuccess;
  const runs = useListRuns({ query: { enabled: ready, queryKey: getListRunsQueryKey() } });

  const [draft, setDraft] = useState(() => readLocal(DRAFT_KEY) ?? "");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [backupUnavailable, setBackupUnavailable] = useState(false);
  const [pending, setPending] = useState<Pending | null>(readPending);
  const [submitError, setSubmitError] = useState<{ message: string; uncertain: boolean } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<"draft" | "server">("draft");
  const [notice, setNotice] = useState(() => readLocal(NOTICE_KEY) !== "dismissed");

  useEffect(() => {
    const saved = writeLocal(DRAFT_KEY, draft);
    setBackupUnavailable(!saved);
    setSavedAt(saved ? Date.now() : null);
  }, [draft]);

  useEffect(() => {
    writeLocal(PENDING_KEY, pending ? JSON.stringify(pending) : null);
  }, [pending]);

  const activeRunId = summary.data?.activeRunId ?? null;
  const viewRunId = selectedRunId ?? activeRunId ?? runs.data?.[0]?.id ?? null;

  const onTerminal = useCallback(
    (id: string) => {
      qc.invalidateQueries({ queryKey: getGetRunQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getGetWorkspaceSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getListRunsQueryKey() });
    },
    [qc],
  );
  const stream = useRunStream(viewRunId, onTerminal, ready);

  const runQ = useGetRun(viewRunId ?? "", {
    query: {
      enabled: ready && !!viewRunId,
      queryKey: getGetRunQueryKey(viewRunId ?? ""),
      refetchInterval: stream.live ? 2000 : false,
    },
  });
  const run = runQ.data && runQ.data.id === viewRunId ? runQ.data : undefined;

  const createRun = useCreateRun();
  const busy = createRun.isPending;
  const anyActive = !!activeRunId && !TERMINAL.has(stream.status ?? (run?.status ?? "running"));

  const submit = (notes: string, parentRunId: string | null) => {
    const trimmed = notes.trim();
    if (!trimmed) { setSubmitError({ message: "Write or paste some notes first.", uncertain: false }); return; }
    if (notes.length > MAX) { setSubmitError({ message: `Notes are over ${MAX.toLocaleString()} characters.`, uncertain: false }); return; }
    const reuse = pending && pending.notes === notes && pending.parentRunId === parentRunId;
    const p: Pending = reuse ? pending! : { key: crypto.randomUUID(), notes, parentRunId, timezone: tz(), referenceDate: localDateString() };
    writeLocal(PENDING_KEY, JSON.stringify(p));
    setPending(p);
    setSubmitError(null);
    createRun.mutate(
      { data: { notes, timezone: p.timezone ?? tz(), referenceDate: p.referenceDate ?? localDateString(), idempotencyKey: p.key, ...(parentRunId ? { parentRunId } : {}) } },
      {
        onSuccess: (r) => {
          setPending(null);
          setSelectedRunId(r.id);
          qc.setQueryData(getGetRunQueryKey(r.id), r);
          qc.invalidateQueries({ queryKey: getListRunsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetWorkspaceSummaryQueryKey() });
          toast({ title: parentRunId ? "Rerun started" : "Run started", description: `Run ${shortId(r.id)} is recording.` });
        },
        onError: (e) => {
          const { message, status } = errorInfo(e);
          const definite = status !== null && status >= 400 && status < 500;
          if (definite) setPending(null);
          setSubmitError({
            message: status === 409 ? `${message} (conflict: another run may be active)` : status === 503 ? `${message} (storage unavailable)` : message,
            uncertain: !definite,
          });
        },
      },
    );
  };

  const selectRun = (id: string) => {
    setSelectedRunId(id);
    setEditorTab("server");
  };

  const s = summary.data;
  const pct = s && s.totalTasks ? Math.round((s.completedTasks / s.totalTasks) * 1000) / 10 : 0;
  const runsById = useMemo(() => new Map((runs.data ?? []).map((r) => [r.id, r])), [runs.data]);

  return (
    <div className="min-h-[100dvh]">
      <header className="border-b border-border bg-background/85 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-extrabold tracking-tight">Note<span className="text-accent">To</span>Plan</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">execution ledger</span>
          </div>
          <dl className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs" data-testid="summary-stats">
            {summary.isLoading ? (
              <div className="h-4 w-60 animate-pulse rounded bg-muted" />
            ) : s ? (
              <>
                <div className="flex gap-1.5"><dt className="text-muted-foreground">tasks</dt><dd data-testid="text-total-tasks">{s.totalTasks}</dd></div>
                <div className="flex gap-1.5"><dt className="text-muted-foreground">done</dt><dd data-testid="text-completed-tasks">{s.completedTasks} <span className="text-muted-foreground">({pct}%)</span></dd></div>
                <div className="flex gap-1.5"><dt className="text-muted-foreground">high</dt><dd className="text-accent" data-testid="text-high-tasks">{s.highPriorityTasks}</dd></div>
                <div className="flex gap-1.5"><dt className="text-muted-foreground">runs</dt><dd data-testid="text-total-runs">{s.totalRuns}</dd></div>
              </>
            ) : null}
            {!online ? <span className="stamp text-destructive" data-testid="status-offline"><WifiOff className="h-3 w-3" />offline</span> : null}
          </dl>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-6 sm:px-6">
        {notice ? (
          <div className="rise mb-5 flex items-start gap-3 rounded-md border border-primary/25 bg-primary/5 p-3 text-sm" role="note" data-testid="notice-privacy">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="flex-1 text-foreground/85">
              Your workspace is tied to a browser cookie. <strong>Clearing cookies loses your saved workspace.</strong> Notes you submit are sent to OpenAI through Replit AI Integrations. No API key is needed; usage is billed to your Replit credits.
            </p>
            <button onClick={() => { setNotice(false); writeLocal(NOTICE_KEY, "dismissed"); }} aria-label="Dismiss notice" className="rounded p-1 hover:bg-primary/10" data-testid="button-dismiss-notice"><X className="h-4 w-4" /></button>
          </div>
        ) : null}

        {summary.isError ? (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm" role="alert">
            <CloudOff className="h-5 w-5 text-destructive" aria-hidden />
            <span className="flex-1">Workspace unavailable: {errorInfo(summary.error).message}. Your device draft is still safe below.</span>
            <button onClick={() => summary.refetch()} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5" data-testid="button-retry-summary"><RefreshCw className="h-3.5 w-3.5" />Retry</button>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-12">
          {/* LEFT: notes + history */}
          <div className="space-y-6 lg:col-span-5">
            <section className="rounded-lg border border-card-border bg-card" aria-label="Notes">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 pt-3">
                <div role="tablist" aria-label="Notes source" className="flex gap-1">
                  <button role="tab" aria-selected={editorTab === "draft"} onClick={() => setEditorTab("draft")} data-testid="tab-draft"
                    className={cn("-mb-px border-b-2 px-3 pb-2 text-sm font-medium", editorTab === "draft" ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                    Device draft
                  </button>
                  <button role="tab" aria-selected={editorTab === "server"} onClick={() => setEditorTab("server")} disabled={!run} data-testid="tab-server"
                    className={cn("-mb-px border-b-2 px-3 pb-2 text-sm font-medium disabled:opacity-40", editorTab === "server" ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                    Server notes{run ? <span className="ml-1 font-mono text-[11px] text-muted-foreground">#{shortId(run.id)}</span> : null}
                  </button>
                </div>
                <span className="pb-2 font-mono text-[10px] text-muted-foreground">
                  {editorTab === "draft" ? (savedAt ? "saved on this device" : "not backed up") : "read-only record"}
                </span>
              </div>

              {editorTab === "draft" ? (
                <div className="p-4">
                  <label htmlFor="notes" className="sr-only">Your notes</label>
                  {backupUnavailable ? <p role="alert" className="mb-2 text-xs text-destructive">Device storage is unavailable. This draft is only in memory until a run is saved; copy it before closing this page.</p> : null}
                  <textarea
                    id="notes"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) submit(draft, null); }}
                    placeholder="Dump everything here. Half-sentences welcome."
                    className="ledger-rule h-[300px] w-full resize-y rounded-md border border-input bg-background px-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="input-notes"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={cn("font-mono text-[11px]", draft.length > MAX ? "text-destructive" : "text-muted-foreground")}>{draft.length.toLocaleString()} / {MAX.toLocaleString()}</span>
                    <button type="button" onClick={() => setDraft((d) => (d.trim() ? `${d.trimEnd()}\n\n${SAMPLE}` : SAMPLE))} className="ml-auto inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-primary hover:bg-primary/10" data-testid="button-sample-notes">
                      <Sparkles className="h-3.5 w-3.5" /> Insert sample notes
                    </button>
                    <button
                      type="button"
                      disabled={busy || !ready || !online}
                      onClick={() => submit(draft, null)}
                      className="group inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
                      data-testid="button-submit-notes"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {submitError?.uncertain && pending ? "Retry submission" : "Turn into a plan"}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </div>
                  <p className="mt-1 text-right font-mono text-[10px] text-muted-foreground">Ctrl/Cmd + Enter</p>
                  {anyActive ? <p className="mt-2 text-xs text-muted-foreground">A run is still executing; the server may refuse a second one until it finishes.</p> : null}
                  {submitError ? (
                    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="text-submit-error">
                      {submitError.message}
                      {submitError.uncertain ? (
                        <p className="mt-1 text-xs text-muted-foreground">The server may or may not have received it. Retrying reuses the same request key, so it will not create a duplicate. Your draft is untouched.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : run ? (
                <div className="p-4">
                  <pre className="ledger-rule max-h-[300px] min-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-dashed border-border bg-muted/40 px-3 font-sans text-[15px]" data-testid="text-server-notes">{run.notes}</pre>
                  <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{run.timezone}</span><span>ref {run.referenceDate}</span><span>{run.processorVersion}</span>
                    <button type="button" onClick={() => { setDraft(run.notes); setEditorTab("draft"); }} className="ml-auto rounded-md px-2 py-1 font-sans text-xs text-primary hover:bg-primary/10" data-testid="button-copy-to-draft">
                      Replace device draft with these
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section aria-label="Run history" className="rounded-lg border border-card-border bg-card p-4">
              <h3 className="font-display text-xl font-semibold">History</h3>
              {!ready || runs.isLoading ? (
                <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded bg-muted" />)}</div>
              ) : runs.isError ? (
                <p className="mt-3 text-sm">Could not load history. <button className="underline" onClick={() => runs.refetch()} data-testid="button-retry-runs">Retry</button></p>
              ) : !runs.data?.length ? (
                <div className="mt-3 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-6 w-6" aria-hidden />
                  No runs yet. Your first submission starts the ledger.
                </div>
              ) : (
                <ol className="mt-3 max-h-[420px] space-y-1 overflow-auto pr-1">
                  {runs.data.map((r) => {
                    const parent = r.parentRunId ? runsById.get(r.parentRunId) : null;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => selectRun(r.id)}
                          aria-current={r.id === viewRunId}
                          className={cn("w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            r.id === viewRunId ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-muted")}
                          data-testid={`button-run-${r.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs">#{shortId(r.id)} · {fmtDateTime(r.createdAt)}</span>
                            <StatusStamp status={r.status} method={r.method} />
                          </div>
                          <p className="mt-1 line-clamp-1 text-sm text-foreground/80">{r.notes}</p>
                          <div className="mt-0.5 flex gap-3 font-mono text-[10px] text-muted-foreground">
                            <span>{r.taskCount} tasks</span><span>{fmtMs(r.durationMs)}</span>
                            {r.parentRunId ? <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />rerun of #{shortId(parent?.id ?? r.parentRunId)}</span> : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>

          {/* RIGHT: execution + output + tasks */}
          <div className="space-y-6 lg:col-span-7">
            {run ? (
              <div className="rise flex flex-wrap items-center gap-3 rounded-lg border border-card-border bg-card px-4 py-3" data-testid="panel-run-meta">
                <span className="font-mono text-sm">Run #{shortId(run.id)}</span>
                <StatusStamp status={run.status} method={run.method} />
                <span className="font-mono text-[11px] text-muted-foreground">{run.model ?? "no model"} · {fmtMs(run.durationMs)}</span>
                {run.parentRunId ? (
                  <button onClick={() => selectRun(run.parentRunId!)} className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline" data-testid="link-parent-run">
                    <GitBranch className="h-3 w-3" />parent #{shortId(run.parentRunId)}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy || !TERMINAL.has(run.status) || !online}
                  onClick={() => submit(run.notes, run.id)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40"
                  data-testid="button-rerun"
                >
                  <RefreshCw className="h-3.5 w-3.5" />Rerun these notes
                </button>
                {run.status === "failed" && run.error ? <p className="w-full text-sm text-destructive" data-testid="text-run-error">{run.error}</p> : null}
                {run.status === "fallback" || (run.method === "fallback" && run.status !== "failed") ? (
                  <p className="w-full text-xs text-muted-foreground">The model path did not finish cleanly, so rule-based extraction produced this output. The events below show exactly where.</p>
                ) : null}
                {run.status === "no_tasks" ? <p className="w-full text-xs text-muted-foreground">This run finished but found nothing actionable{run.method === "fallback" ? " (via fallback extraction)" : ""}. That is a real outcome, not an error.</p> : null}
              </div>
            ) : viewRunId && runQ.isError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">Run could not load. <button className="underline" onClick={() => runQ.refetch()}>Retry</button></p>
            ) : null}

            <ExecutionPanel run={run} events={stream.events} live={stream.live} loading={stream.isLoading} error={stream.error} onRetry={() => stream.refetch()} />

            {run ? (
              <section aria-label="Recorded output" className="rounded-lg border border-dashed border-primary/40 bg-primary/[0.03] p-4 sm:p-5" data-testid="panel-output">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-display text-xl font-semibold">Recorded output</h3>
                  <span className="stamp text-primary">immutable snapshot</span>
                </header>
                {run.output.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">{TERMINAL.has(run.status) ? "This run recorded no tasks." : "Output is written when the run finishes."}</p>
                ) : (
                  <ol className="mt-3 divide-y divide-dashed divide-border">
                    {run.output.map((t, i) => (
                      <li key={i} className="flex gap-3 py-2" data-testid={`row-output-${i}`}>
                        <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{t.title}</p>
                          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            <span className={t.priority === "High" ? "text-accent" : ""}>{t.priority}</span> · {t.category}{t.dueDate ? ` · ${fmtDue(t.dueDate)}` : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ) : null}

            <TasksPanel ready={ready} />
          </div>
        </div>
      </main>
    </div>
  );
}
