import { useEffect, useRef, useState } from "react";
import { getGetRunEventsQueryKey, useGetRunEvents, type ExecutionEvent } from "@workspace/api-client-react";
import { mergeEvents, TERMINAL } from "@/lib/run-utils";

interface StreamState {
  runId: string | null;
  events: ExecutionEvent[];
  cursor: number;
  status: string | null;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** Cursor-based event follower. Polls ~1s while the run is non-terminal; merges by seq. */
export function useRunStream(runId: string | null, onTerminal: (runId: string) => void, ready = true) {
  const [state, setState] = useState<StreamState>({ runId, events: [], cursor: 0, status: null });
  const cur: StreamState = state.runId === runId ? state : { runId, events: [], cursor: 0, status: null };
  const live = !!runId && (cur.status === null || !TERMINAL.has(cur.status));
  const notified = useRef(new Set<string>());
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  const id = runId ?? "";
  const params = { after: cur.cursor };
  const q = useGetRunEvents(id, params, {
    query: {
      enabled: !!runId && ready,
      queryKey: getGetRunEventsQueryKey(id, params),
      refetchInterval: live ? 1000 : false,
      refetchIntervalInBackground: false,
      retry: 3,
    },
  });

  useEffect(() => {
    const page = q.data;
    if (!page || !runId) return;
    setState((prev) => {
      const base = prev.runId === runId ? prev : { runId, events: [], cursor: 0, status: null };
      const incoming = page.events.filter((e) => e.runId === runId);
      const events = incoming.length ? mergeEvents(base.events, incoming) : base.events;
      const maxSeq = events.length ? events[events.length - 1].seq : 0;
      const cursor = Math.max(base.cursor, page.cursor ?? 0, maxSeq);
      if (events === base.events && cursor === base.cursor && page.status === base.status) return base;
      return { runId, events, cursor, status: page.status };
    });
  }, [q.data, runId]);

  useEffect(() => {
    if (!runId || !cur.status) return;
    if (TERMINAL.has(cur.status) && !notified.current.has(runId)) {
      notified.current.add(runId);
      onTerminalRef.current(runId);
    }
  }, [runId, cur.status]);

  return {
    events: cur.events,
    status: cur.status,
    live,
    isLoading: !!runId && cur.events.length === 0 && q.isLoading,
    error: q.error,
    refetch: q.refetch,
  };
}
