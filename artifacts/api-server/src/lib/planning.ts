import { z } from "zod";

export const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const candidateSchema = z.object({
  title: z.string().trim().min(3).max(240),
  priority: z.enum(["High", "Medium", "Low"]),
  category: z.string().trim().min(1).max(40),
  source: z.string().min(1).max(2000),
});
export const extractionSchema = z.object({ tasks: z.array(candidateSchema).max(40) });
export type Candidate = z.infer<typeof candidateSchema>;
export type PlannedTask = { title: string; priority: "High" | "Medium" | "Low"; category: string; dueDate: string | null; explanation: string };

export function explicitDate(source: string, reference: string): string | null {
  if (/\b(?:maybe|possibly|perhaps|not|after)\s+(?:due\s+)?(?:today|tomorrow|\d{4}-\d{2}-\d{2})\b/i.test(source)) return null;
  const cues = new Set((source.toLowerCase().match(/\b(?:\d{4}-\d{2}-\d{2}|today|tomorrow)\b/g) ?? []));
  if (cues.size > 1) return null;
  const iso = source.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return validDate(iso) ? iso : null;
  if (/\b(day after tomorrow|yesterday|next week|someday)\b/i.test(source)) return null;
  if (/\btomorrow\b/i.test(source)) {
    const d = new Date(`${reference}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return /\btoday\b/i.test(source) ? reference : null;
}

export function fallbackCandidates(notes: string): Candidate[] {
  return notes.split(/\n+|(?<=[.!?;])\s+/).map(s => s.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/, "").trim())
    .filter(s => s.length >= 3 && s.length <= 2000)
    .filter(s => !/\b(already|finished|completed|cancelled|canceled|don't|do not|no need to|never|shouldn't|should not|must not)\b/i.test(s))
    .filter(s => /^(?:(?:i|we)\s+)?(?:(?:need|have|want)\s+to\s+|please\s+|(?:urgent|asap|high priority|low priority)\s*[:–-]\s*)?(?:send|email|call|buy|book|schedule|review|finish|complete|prepare|write|create|update|fix|submit|pay|plan|clean|pick up|order|check|research|read|meet|contact|draft|renew|organize|build|test|deploy|ship|cancel|reply|follow up)\b/i.test(s))
    .slice(0, 40).map(source => ({
      title: source.slice(0, 240),
      priority: /\b(urgent|asap|critical|high priority)\b/i.test(source) ? "High" : /\b(low priority|whenever|someday|nice to have)\b/i.test(source) ? "Low" : "Medium",
      category: /\b(client|project|report|meeting|proposal|work)\b/i.test(source) ? "Work" : /\b(buy|groceries|order|shopping)\b/i.test(source) ? "Shopping" : /\b(doctor|dentist|exercise|health)\b/i.test(source) ? "Health" : "General",
      source,
    }));
}

export function organize(candidates: Candidate[], notes: string, reference: string): PlannedTask[] {
  const seen = new Set<string>();
  return candidates.filter(c => {
    if (!notes.includes(c.source)) throw new Error("Output source was not present in the notes");
    const key = c.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(c => ({
    title: c.title,
    priority: c.priority,
    category: c.category.trim().replace(/\s+/g, " ").replace(/\b\w/g, s => s.toUpperCase()),
    dueDate: explicitDate(c.source, reference),
    explanation: `Priority: ${c.priority}; category: ${c.category}. Based on the quoted action; absent or ambiguous dates remain unset.`,
  })).sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.priority] - { High: 0, Medium: 1, Low: 2 }[b.priority]) ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}
