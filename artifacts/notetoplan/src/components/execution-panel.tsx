import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  ReactFlow,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Pause, Play, RotateCcw, SkipForward, Radio, History, CircleDashed } from "lucide-react";
import type { ExecutionEvent, Run } from "@workspace/api-client-react";
import {
  STAGE_BLURB,
  deriveStages,
  fmtMs,
  fmtTime,
  statusTone,
  type StageState,
  type StageView,
} from "@/lib/run-utils";
import { cn } from "@/lib/utils";

const POS: Record<string, { x: number; y: number }> = {
  receive: { x: 0, y: 0 },
  validate: { x: 190, y: 0 },
  extract: { x: 380, y: 0 },
  structure: { x: 570, y: 0 },
  repair: { x: 570, y: 120 },
  organize: { x: 380, y: 120 },
  save: { x: 190, y: 120 },
  finish: { x: 0, y: 120 },
  fallback: { x: 380, y: 240 },
  recovery: { x: 0, y: 240 },
};

const EDGES: [string, string, string, string, boolean?][] = [
  ["receive", "validate", "r-s", "l-t"],
  ["validate", "extract", "r-s", "l-t"],
  ["extract", "structure", "r-s", "l-t"],
  ["structure", "repair", "b-s", "t-t", true],
  ["repair", "organize", "l-s", "r-t", true],
  ["structure", "organize", "l-s", "r-t"],
  ["organize", "save", "l-s", "r-t"],
  ["save", "finish", "l-s", "r-t"],
  ["extract", "fallback", "b-s", "t-t", true],
  ["repair", "fallback", "b-s", "r-t", true],
  ["fallback", "organize", "t-s", "b-t", true],
  ["recovery", "validate", "t-s", "b-t", true],
];

function stateClasses(s: StageState) {
  switch (s) {
    case "succeeded":
      return "border-[hsl(162_42%_34%)] bg-[hsl(162_40%_94%)]";
    case "failed":
    case "interrupted":
      return "border-destructive bg-destructive/10";
    case "retrying":
      return "border-accent bg-accent/10";
    case "started":
      return "border-primary bg-primary/10";
    case "skipped":
      return "border-dashed border-muted-foreground/50 bg-muted/60";
    default:
      return "border-dashed border-border bg-card/60 opacity-70";
  }
}

type StageNodeData = { view: StageView; selected: boolean; onSelect: (s: string) => void };

function StageNode({ data }: NodeProps<Node<StageNodeData>>) {
  const { view, selected, onSelect } = data;
  const hs = "!w-1.5 !h-1.5 !min-w-0 !min-h-0 !border-0 !bg-transparent";
  return (
    <button
      type="button"
      onClick={() => onSelect(view.stage)}
      data-testid={`node-stage-${view.stage}`}
      aria-pressed={selected}
      className={cn(
        "w-[150px] rounded-md border-2 px-3 py-2 text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        stateClasses(view.state),
        selected && "ring-2 ring-accent ring-offset-2 ring-offset-background",
      )}
    >
      {(["l", "r", "t", "b"] as const).map((side) => {
        const p = side === "l" ? Position.Left : side === "r" ? Position.Right : side === "t" ? Position.Top : Position.Bottom;
        return [
          <Handle key={`${side}-s`} id={`${side}-s`} type="source" position={p} className={hs} isConnectable={false} />,
          <Handle key={`${side}-t`} id={`${side}-t`} type="target" position={p} className={hs} isConnectable={false} />,
        ];
      })}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] font-medium lowercase tracking-tight text-foreground">{view.stage}</span>
        {view.state === "started" || view.state === "retrying" ? (
          <span className="pulse-dot h-2 w-2 rounded-full bg-accent" />
        ) : null}
      </div>
      <div className={cn("mt-0.5 font-mono text-[10px] uppercase tracking-wider", statusTone(view.state))}>
        {view.state}
        {view.attempts > 1 ? ` · try ${view.attempts}` : ""}
      </div>
    </button>
  );
}

const nodeTypes = { stage: StageNode };

function FlowDiagram({ views, selected, onSelect }: { views: Record<string, StageView>; selected: string | null; onSelect: (s: string) => void }) {
  const nodes: Node<StageNodeData>[] = useMemo(
    () =>
      Object.keys(views)
        .filter((s) => POS[s] || views[s].events.length)
        .map((s, i) => ({
          id: s,
          type: "stage",
          position: POS[s] ?? { x: 570, y: 240 + i * 4 },
          data: { view: views[s], selected: selected === s, onSelect },
          draggable: false,
          selectable: false,
        })),
    [views, selected, onSelect],
  );
  const edges: Edge[] = useMemo(
    () =>
      EDGES.map(([a, b, sh, th, branch]) => {
        const happened = (s: string) => views[s]?.events.some(e => e.status !== "skipped");
        const done = views[a]?.state === "succeeded" && happened(b) && views[b]?.state !== "skipped";
        const active = happened(a) && (views[b]?.state === "started" || views[b]?.state === "retrying");
        return {
          id: `${a}-${b}`,
          source: a,
          target: b,
          sourceHandle: sh,
          targetHandle: th,
          type: "smoothstep",
          animated: active,
          style: {
            stroke: done ? "hsl(162 42% 34%)" : active ? "hsl(var(--accent))" : "hsl(var(--border))",
            strokeWidth: done || active ? 2 : 1.5,
            strokeDasharray: branch && !done ? "4 4" : undefined,
          },
        };
      }),
    [views],
  );
  return (
    <div className="h-[340px] w-full rounded-md border border-dashed border-border bg-[radial-gradient(hsl(var(--primary)/0.12)_1px,transparent_1px)] [background-size:18px_18px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}

function MobileTimeline({ views, selected, onSelect }: { views: Record<string, StageView>; selected: string | null; onSelect: (s: string) => void }) {
  const list = Object.values(views).filter((v) => v.events.length || !["fallback", "recovery"].includes(v.stage));
  return (
    <ol className="relative ml-2 border-l-2 border-dashed border-border" aria-label="Execution stages">
      {list.map((v) => (
        <li key={v.stage} className="relative pl-5 pb-1">
          <span
            className={cn(
              "absolute -left-[7px] top-3.5 h-3 w-3 rounded-full border-2 border-background",
              v.state === "succeeded" ? "bg-[hsl(162_42%_34%)]" : v.state === "failed" || v.state === "interrupted" ? "bg-destructive" : v.state === "pending" ? "bg-border" : "bg-accent",
            )}
          />
          <button
            type="button"
            onClick={() => onSelect(v.stage)}
            aria-pressed={selected === v.stage}
            data-testid={`timeline-stage-${v.stage}`}
            className={cn("w-full rounded px-2 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === v.stage && "bg-muted")}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-sm">{v.stage}</span>
              <span className={cn("font-mono text-[10px] uppercase tracking-wider", statusTone(v.state))}>{v.state}</span>
            </div>
            <div className="text-xs text-muted-foreground">{STAGE_BLURB[v.stage] ?? "Recorded stage"}</div>
          </button>
        </li>
      ))}
    </ol>
  );
}

function StageDetail({ view }: { view: StageView | null }) {
  if (!view) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        Select a stage to inspect its recorded events. Only what the server logged is shown here, never model reasoning.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card p-4" data-testid="panel-stage-detail" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-display text-lg font-semibold">{view.stage}</h4>
        <span className={cn("stamp", statusTone(view.state))}>{view.state}</span>
      </div>
      <p className="text-xs text-muted-foreground">{STAGE_BLURB[view.stage] ?? "Recorded stage"}</p>
      {view.events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No events recorded for this stage {"(yet)"}.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {view.events.map((e) => (
            <li key={e.seq} className="rounded border border-border/70 bg-background/60 p-2.5" data-testid={`event-${e.seq}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span>#{e.seq}</span>
                <span className={statusTone(e.status)}>{e.status}</span>
                <span>attempt {e.attempt}</span>
                <span>{fmtTime(e.timestamp)}</span>
                <span>{fmtMs(e.durationMs)}</span>
              </div>
              <p className="mt-1 text-sm">{e.summary}</p>
              {e.details ? (
                <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/70 p-2 font-mono text-[11px] leading-relaxed">{e.details}</pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SPEEDS = [0.5, 1, 2, 4];

export function ExecutionPanel({
  run,
  events,
  live,
  loading,
  error,
  onRetry,
}: {
  run: Run | undefined;
  events: ExecutionEvent[];
  live: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [replay, setReplay] = useState<{ pos: number; playing: boolean } | null>(null);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const runId = run?.id;

  useEffect(() => {
    setReplay(null);
    setSelected(null);
  }, [runId]);

  // replay can only reveal events already seen by the client
  const total = events.length;
  const pos = replay ? Math.min(replay.pos, total) : total;
  const visible = useMemo(() => events.slice(0, pos), [events, pos]);
  const views = useMemo(() => deriveStages(visible), [visible]);

  useEffect(() => {
    if (!replay?.playing) return;
    if (replay.pos >= total) {
      setReplay((r) => (r ? { ...r, playing: false } : r));
      return;
    }
    const prev = events[replay.pos - 1];
    const next = events[replay.pos];
    const gap = prev ? new Date(next.timestamp).getTime() - new Date(prev.timestamp).getTime() : 300;
    const delay = Math.max(0, gap) / speed;
    const t = window.setTimeout(() => setReplay((r) => (r ? { ...r, pos: r.pos + 1 } : r)), delay);
    return () => window.clearTimeout(t);
  }, [replay, total, events, speed]);

  const lastVisible = visible[visible.length - 1];
  useEffect(() => {
    if (replay && lastVisible) setSelected(lastVisible.stage);
  }, [replay, lastVisible]);

  const play = () => setReplay((r) => (!r || r.pos >= total ? { pos: 0, playing: true } : { ...r, playing: !r.playing }));
  const step = () => setReplay((r) => ({ pos: Math.min(total, (r?.pos ?? 0) + 1), playing: false }));
  const restart = () => setReplay({ pos: 0, playing: false });
  const back = () => setReplay((r) => ({ pos: Math.max(0, (r?.pos ?? total) - 1), playing: false }));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
    if (e.key === " " || e.key === "k") { e.preventDefault(); play(); }
    else if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); step(); }
    else if (e.key === "ArrowLeft" || e.key === "j") { e.preventDefault(); back(); }
    else if (e.key === "Home" || e.key === "0") { e.preventDefault(); restart(); }
  };

  const elapsed = (() => {
    if (!events.length || !lastVisible) return 0;
    return new Date(lastVisible.timestamp).getTime() - new Date(events[0].timestamp).getTime();
  })();

  if (!run) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center">
        <CircleDashed className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <h3 className="mt-3 font-display text-xl">No execution on record</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Submit notes and every stage the server performs will be logged here, then replayable exactly as it happened.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Execution record" className="rounded-lg border border-card-border bg-card p-4 sm:p-5" data-testid="panel-execution">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {replay ? (
            <span className="stamp text-accent"><History className="h-3 w-3" aria-hidden />Replay</span>
          ) : live ? (
            <span className="stamp text-primary"><Radio className="h-3 w-3 pulse-dot" aria-hidden />Live</span>
          ) : (
            <span className="stamp text-muted-foreground">Recorded</span>
          )}
          <h3 className="font-display text-xl font-semibold">Execution record</h3>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {pos}/{total} events · {fmtMs(elapsed)}
        </span>
      </header>

      {error ? (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Disconnected from the execution record. Previously received events remain visible; processing may still be running on the server.{" "}
          <button className="underline underline-offset-2" onClick={onRetry} data-testid="button-retry-events">Retry</button>
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <div className="h-[340px] animate-pulse rounded-md bg-muted" aria-label="Loading events" />
        ) : (
          <>
            <div className="hidden md:block">
              <FlowDiagram views={views} selected={selected} onSelect={setSelected} />
            </div>
            <div className="md:hidden">
              <MobileTimeline views={views} selected={selected} onSelect={setSelected} />
            </div>
          </>
        )}
      </div>

      <div
        className="mt-4 rounded-md border border-border bg-background/70 p-3 focus-within:ring-2 focus-within:ring-ring/40"
        onKeyDown={onKey}
        role="group"
        aria-label="Replay controls. Space play or pause, arrows step, Home restart."
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={play} disabled={!total} data-testid="button-replay-play" aria-label={replay?.playing ? "Pause replay" : "Play replay"} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95 disabled:opacity-40">
            {replay?.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button type="button" onClick={step} disabled={!total || pos >= total && !!replay} data-testid="button-replay-next" aria-label="Next event" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-40">
            <SkipForward className="h-4 w-4" />
          </button>
          <button type="button" onClick={restart} disabled={!total} data-testid="button-replay-restart" aria-label="Restart replay" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-40">
            <RotateCcw className="h-4 w-4" />
          </button>
          <label className="sr-only" htmlFor="replay-scrubber">Replay position</label>
          <input
            id="replay-scrubber"
            type="range"
            min={0}
            max={total}
            value={pos}
            disabled={!total}
            onChange={(e) => setReplay({ pos: Number(e.target.value), playing: false })}
            className="min-w-[120px] flex-1 accent-[hsl(var(--accent))]"
            data-testid="input-replay-scrubber"
          />
          <label className="sr-only" htmlFor="replay-speed">Replay speed</label>
          <select id="replay-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-9 rounded-md border border-input bg-card px-2 font-mono text-xs" data-testid="select-replay-speed">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
          {replay ? (
            <button type="button" onClick={() => setReplay(null)} className="h-9 rounded-md px-3 text-xs font-medium text-primary hover:bg-primary/10" data-testid="button-replay-exit">
              {live ? "Back to live" : "Show all"}
            </button>
          ) : null}
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          Replay re-reads recorded events only. It never contacts the model or changes tasks.
        </p>
      </div>

      <div className="mt-4">
        <StageDetail view={selected ? views[selected] ?? null : null} />
      </div>
      <div className="sr-only" aria-live="polite">{lastVisible ? `${lastVisible.stage} ${lastVisible.status}` : ""}</div>
    </section>
  );
}

