import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, RotateCcw, Pencil, ListChecks } from "lucide-react";
import {
  getGetWorkspaceSummaryQueryKey,
  getListTasksQueryKey,
  useDeleteTask,
  useListTasks,
  useUpdateTask,
  type Task,
  type TaskUpdate,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { errorInfo, fmtDue } from "@/lib/run-utils";
import { cn } from "@/lib/utils";

const PRIORITIES = ["High", "Medium", "Low"] as const;
const PRIO_STYLE: Record<string, string> = {
  High: "text-accent",
  Medium: "text-primary",
  Low: "text-muted-foreground",
};

function TaskRow({ task }: { task: Task }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [category, setCategory] = useState(task.category);

  const patch = (data: TaskUpdate, label: string) =>
    update.mutate(
      { id: task.id, data },
      {
        onSuccess: (t) => {
          qc.setQueryData<Task[]>(getListTasksQueryKey(), (old) => old?.map((x) => (x.id === t.id ? t : x)));
          qc.invalidateQueries({ queryKey: getGetWorkspaceSummaryQueryKey() });
        },
        onError: (e) => toast({ title: `Could not ${label}`, description: errorInfo(e).message, variant: "destructive" }),
      },
    );

  const saveText = () => {
    const t = title.trim();
    const c = category.trim();
    if (!t || !c) {
      toast({ title: "Title and category are required", variant: "destructive" });
      return;
    }
    const data: TaskUpdate = {};
    if (t !== task.title) data.title = t.slice(0, 240);
    if (c !== task.category) data.category = c.slice(0, 40);
    if (Object.keys(data).length) patch(data, "save task");
    setEditing(false);
  };

  return (
    <li
      className={cn("group rise grid grid-cols-[auto_1fr] gap-3 border-b border-dashed border-border py-3 last:border-0", task.completed && "opacity-60")}
      data-testid={`row-task-${task.id}`}
    >
      <button
        type="button"
        onClick={() => patch({ completed: !task.completed }, task.completed ? "reopen task" : "complete task")}
        aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
        data-testid={`button-toggle-task-${task.id}`}
        className={cn(
          "mt-0.5 flex h-5 w-5 items-center justify-center rounded border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          task.completed ? "border-[hsl(162_42%_34%)] bg-[hsl(162_42%_34%)] text-primary-foreground" : "border-input hover:border-primary",
        )}
      >
        {task.completed ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
      </button>
      <div className="min-w-0">
        {editing ? (
          <form
            onSubmit={(e) => { e.preventDefault(); saveText(); }}
            onKeyDown={(e) => { if (e.key === "Escape") { setTitle(task.title); setCategory(task.category); setEditing(false); } }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input autoFocus value={title} maxLength={240} onChange={(e) => setTitle(e.target.value)} aria-label="Task title" className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm" data-testid={`input-task-title-${task.id}`} />
            <input value={category} maxLength={40} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="w-full rounded border border-input bg-background px-2 py-1 font-mono text-xs sm:w-32" data-testid={`input-task-category-${task.id}`} />
            <div className="flex gap-1">
              <button type="submit" className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground" data-testid={`button-save-task-${task.id}`}>Save</button>
              <button type="button" onClick={() => { setTitle(task.title); setCategory(task.category); setEditing(false); }} className="rounded px-2 py-1 text-xs hover:bg-muted">Cancel</button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn("text-left text-[15px] leading-snug hover:text-primary focus-visible:outline-none focus-visible:underline", task.completed && "line-through decoration-accent/70")}
            data-testid={`text-task-title-${task.id}`}
          >
            {task.title}
            <Pencil className="ml-1.5 inline h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" aria-hidden />
          </button>
        )}
        {task.explanation ? <p className="mt-0.5 text-xs text-muted-foreground">{task.explanation}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={task.priority}
            onChange={(e) => patch({ priority: e.target.value as Task["priority"] }, "change priority")}
            aria-label="Priority"
            className={cn("h-7 rounded border border-border bg-transparent px-1.5 font-mono text-[11px] uppercase tracking-wider", PRIO_STYLE[task.priority])}
            data-testid={`select-task-priority-${task.id}`}
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {!editing ? (
            <button type="button" onClick={() => setEditing(true)} className="h-7 rounded bg-secondary px-2 font-mono text-[11px] text-secondary-foreground" data-testid={`text-task-category-${task.id}`}>
              {task.category}
            </button>
          ) : null}
          <label className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <span className="sr-only">Due date</span>
            <input
              type="date"
              value={task.dueDate ?? ""}
              onChange={(e) => patch({ dueDate: e.target.value || null }, "change due date")}
              className="h-7 rounded border border-border bg-transparent px-1.5"
              data-testid={`input-task-due-${task.id}`}
            />
          </label>
          {task.dueDate ? <span className="font-mono text-[11px] text-muted-foreground">{fmtDue(task.dueDate)}</span> : null}
          {task.dueDate ? (
            <button type="button" onClick={() => patch({ dueDate: null }, "clear due date")} className="font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline" data-testid={`button-clear-due-${task.id}`}>clear</button>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {task.completed ? (
              <button type="button" onClick={() => patch({ completed: false }, "reopen task")} className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs hover:bg-muted" data-testid={`button-reopen-task-${task.id}`}>
                <RotateCcw className="h-3 w-3" /> Reopen
              </button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button type="button" aria-label={`Delete ${task.title}`} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`button-delete-task-${task.id}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-display">Delete this task?</AlertDialogTitle>
                  <AlertDialogDescription>
                    "{task.title}" will be removed from your plan. The run's recorded output keeps its original copy.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid={`button-confirm-delete-${task.id}`}
                    onClick={() =>
                      del.mutate(
                        { id: task.id },
                        {
                          onSuccess: () => {
                            qc.setQueryData<Task[]>(getListTasksQueryKey(), (old) => old?.filter((x) => x.id !== task.id));
                            qc.invalidateQueries({ queryKey: getGetWorkspaceSummaryQueryKey() });
                          },
                          onError: (e) => toast({ title: "Could not delete", description: errorInfo(e).message, variant: "destructive" }),
                        },
                      )
                    }
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </li>
  );
}

function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "h-7 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/60",
      )}
    >
      {children}
    </button>
  );
}

export function TasksPanel({ ready }: { ready: boolean }) {
  const tq = useListTasks({ query: { enabled: ready, queryKey: getListTasksQueryKey() } });
  const { data: tasks, error, refetch } = tq;
  const isLoading = !ready || tq.isLoading;
  const [status, setStatus] = useState<"all" | "open" | "done">("open");
  const [prio, setPrio] = useState<string>("all");
  const [cat, setCat] = useState<string>("all");

  const categories = useMemo(() => [...new Set((tasks ?? []).map((t) => t.category))].sort(), [tasks]);
  const filtered = useMemo(
    () =>
      (tasks ?? []).filter(
        (t) =>
          (status === "all" || (status === "open" ? !t.completed : t.completed)) &&
          (prio === "all" || t.priority === prio) &&
          (cat === "all" || t.category === cat),
      ),
    [tasks, status, prio, cat],
  );

  return (
    <section aria-label="Your plan" className="rounded-lg border border-card-border bg-card p-4 sm:p-5" data-testid="panel-tasks">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-semibold">The plan</h3>
        <span className="font-mono text-[11px] text-muted-foreground">editable · separate from recorded output</span>
      </header>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {(["open", "done", "all"] as const).map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)} testId={`filter-status-${s}`}>{s === "done" ? "Done" : s === "open" ? "Open" : "All"}</Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <label className="sr-only" htmlFor="filter-priority">Priority</label>
        <select id="filter-priority" value={prio} onChange={(e) => setPrio(e.target.value)} className="h-7 rounded-full border border-border bg-transparent px-2 text-xs" data-testid="filter-priority">
          <option value="all">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="sr-only" htmlFor="filter-category">Category</label>
        <select id="filter-category" value={cat} onChange={(e) => setCat(e.target.value)} className="h-7 max-w-[160px] rounded-full border border-border bg-transparent px-2 text-xs" data-testid="filter-category">
          <option value="all">Any category</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-muted" />)}</div>
      ) : error ? (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Tasks could not load. {errorInfo(error).message}{" "}
          <button className="underline" onClick={() => refetch()} data-testid="button-retry-tasks">Retry</button>
        </div>
      ) : !tasks?.length ? (
        <div className="mt-4 flex flex-col items-center rounded-md border border-dashed border-border py-10 text-center">
          <ListChecks className="h-7 w-7 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-display text-lg">Nothing planned yet</p>
          <p className="text-sm text-muted-foreground">Tasks appear here after a run saves them.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No tasks match these filters.</p>
      ) : (
        <ul className="mt-2">{filtered.map((t) => <TaskRow key={`${t.id}-${t.updatedAt}`} task={t} />)}</ul>
      )}
    </section>
  );
}
