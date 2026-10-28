// Scheduled tasks: a prompt for a model or agent, an orchestrator goal, or a terminal command, run at a
// set time or on repeat. Each task has its own chat where every run is added, so results are easy to
// find. Tasks run one at a time, and wait while you're using the chat. While any task is on, closing
// the window keeps Penumbra in the menu bar (see electron/tray.cjs) so tasks still run on time.
import { useSyncExternalStore } from 'react';
import { host } from './host';
import { uid, type Conversation, type UiMessage } from './store';
import { ORCHESTRATOR_ID } from './agents/orchestrator';
import { getAgent } from './agents/agents';
import { approval, chatController, getConversations, openChatRequest, streaming, updateConversations } from './session';

export type TaskKind = 'prompt' | 'orchestrator' | 'command';

export type Schedule =
  | { type: 'once'; at: number }
  | { type: 'every'; minutes: number }
  /** days: 0 = Sunday … 6 = Saturday; time "HH:MM" in local time. */
  | { type: 'daily'; time: string; days: number[] };

/** What a task may do without asking. Everything else waits for you, with a notification. */
export type PreApproval = 'web' | 'terminal';
const APPROVAL_TOOLS: Record<PreApproval, string> = { web: 'web_fetch', terminal: 'run_command' };

export interface ScheduledTask {
  id: string;
  name: string;
  enabled: boolean;
  kind: TaskKind;
  /** The prompt, or the orchestrator's goal. */
  prompt: string;
  /** Prompt tasks: the agent that answers, or none for the plain model. */
  agentId?: string;
  /** The model (prompt tasks without an agent, and the orchestrator's planner). */
  model: string;
  folder?: string;
  command?: string;
  preApproved: PreApproval[];
  schedule: Schedule;
  /** The chat this task's runs go into. */
  convId?: string;
  nextRun: number | null;
  lastRun?: number;
  lastStatus?: 'ok' | 'error' | 'running' | 'waiting';
  lastError?: string;
  createdAt: number;
}

/** One run of a task, for its run log. */
export interface RunLogEntry {
  id: string;
  taskId: string;
  startedAt: number;
  endedAt?: number;
  /** schedule: on time; manual: Run now; missed: was due while Penumbra was quit. */
  trigger: 'schedule' | 'manual' | 'missed';
  status: 'running' | 'ok' | 'error';
  /** Who did the work, e.g. "Researcher · qwen3.8:27b-mlx" or "Command". */
  by: string;
  /** The start of the result. */
  summary?: string;
  error?: string;
  /** Tools it used, e.g. { web_search: 1, web_fetch: 2 }. */
  tools?: Record<string, number>;
  /** Questions it had to wait for, and how long. */
  approvals?: { title: string; waitedMs: number }[];
  /** The reply in the task's chat. */
  msgId?: string;
}

export interface SchedulerSettings {
  /** Stay in the menu bar when the window closes, while any task is on. */
  menuBar: boolean;
  notify: boolean;
}

const TASKS_KEY = 'ollama-gui.schedule';
const SETTINGS_KEY = 'ollama-gui.scheduleSettings';
const LOG_KEY = 'ollama-gui.scheduleLog';
const LOG_PER_TASK = 50;
const TICK_MS = 15000;

const load = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
};

let tasks: ScheduledTask[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
  } catch {
    return [];
  }
})();
let settings: SchedulerSettings = load(SETTINGS_KEY, { menuBar: true, notify: true });
let log: RunLogEntry[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch {
    return [];
  }
})();
let running = null as string | null;
let snapshot: { tasks: ScheduledTask[]; settings: SchedulerSettings; running: string | null; log: RunLogEntry[] } = { tasks, settings, running, log };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { tasks, settings, running, log };
  listeners.forEach((l) => l());
  syncTray();
}

function saveTasks(next: ScheduledTask[]) {
  tasks = next;
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch {
    /* storage unavailable */
  }
  emit();
}

function saveLog(next: RunLogEntry[]) {
  // Newest first, and only the latest runs of each task.
  const count: Record<string, number> = {};
  log = next.filter((e) => (count[e.taskId] = (count[e.taskId] ?? 0) + 1) <= LOG_PER_TASK);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable */
  }
  emit();
}

const patchLog = (id: string, fn: (e: RunLogEntry) => RunLogEntry) => saveLog(log.map((e) => (e.id === id ? fn(e) : e)));

export const clearTaskLog = (taskId: string) => saveLog(log.filter((e) => e.taskId !== taskId));

const patchTask = (id: string, patch: Partial<ScheduledTask>) => saveTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));

export const useScheduler = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => snapshot);

export function setSchedulerSettings(patch: Partial<SchedulerSettings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
  emit();
}

// ---- timing --------------------------------------------------------------------------------------

/** The next time a schedule fires after `from`, or null if it never will again. */
export function nextAfter(s: Schedule, from: number): number | null {
  if (s.type === 'once') return s.at > from ? s.at : null;
  if (s.type === 'every') return from + Math.max(1, s.minutes) * 60000;
  const [h, m] = s.time.split(':').map((n) => parseInt(n, 10) || 0);
  const days = s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
  const d = new Date(from);
  for (let i = 0; i < 8; i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h, m, 0, 0);
    if (c.getTime() > from && days.includes(c.getDay())) return c.getTime();
  }
  return null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeSchedule(s: Schedule): string {
  if (s.type === 'once') return `Once, ${new Date(s.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
  if (s.type === 'every') {
    const m = s.minutes;
    if (m % 1440 === 0) return m === 1440 ? 'Every day' : `Every ${m / 1440} days`;
    if (m % 60 === 0) return m === 60 ? 'Every hour' : `Every ${m / 60} hours`;
    return `Every ${m} minutes`;
  }
  const days = [...s.days].sort();
  const when = !days.length || days.length === 7 ? 'Every day' : days.join() === '1,2,3,4,5' ? 'Weekdays' : days.join() === '0,6' ? 'Weekends' : days.map((d) => DAY_NAMES[d]).join(', ');
  const [h, m] = s.time.split(':').map(Number);
  return `${when} at ${new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** "in 5 min", "tomorrow 8:00 AM", … */
export function describeWhen(t: number, now = Date.now()): string {
  const diff = t - now;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `in ${Math.round(diff / 60000)} min`;
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// ---- editing -------------------------------------------------------------------------------------

export function saveTask(task: Omit<ScheduledTask, 'nextRun' | 'createdAt'> & Partial<Pick<ScheduledTask, 'createdAt'>>) {
  const now = Date.now();
  const existing = tasks.find((t) => t.id === task.id);
  const changedSchedule = !existing || JSON.stringify(existing.schedule) !== JSON.stringify(task.schedule) || (!existing.enabled && task.enabled);
  const next: ScheduledTask = {
    ...existing,
    ...task,
    createdAt: existing?.createdAt ?? now,
    nextRun: !task.enabled ? existing?.nextRun ?? null : changedSchedule ? nextAfter(task.schedule, now) : existing!.nextRun,
  };
  saveTasks(existing ? tasks.map((t) => (t.id === task.id ? next : t)) : [next, ...tasks]);
  return next;
}

export function setTaskEnabled(id: string, enabled: boolean) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  patchTask(id, { enabled, nextRun: enabled ? nextAfter(t.schedule, Date.now()) : t.nextRun });
}

export function deleteTask(id: string) {
  saveTasks(tasks.filter((t) => t.id !== id));
  clearTaskLog(id);
}

/** Due now, regardless of its schedule; runs as soon as nothing else is. */
const manualRuns = new Set<string>();
export function runTaskNow(id: string) {
  manualRuns.add(id);
  patchTask(id, { nextRun: Date.now() - 1, ...(tasks.find((t) => t.id === id)?.enabled ? {} : { enabled: true }) });
  tick();
}

export const newTaskId = uid;

// ---- running -------------------------------------------------------------------------------------

/** The task's chat, created on its first run and kept in step with the task's settings. */
function taskChat(t: ScheduledTask): string {
  const settingsFor = (c: Partial<Conversation>): Partial<Conversation> => ({
    ...c,
    title: `⏰ ${t.name}`,
    model: t.model,
    agentId: t.kind === 'orchestrator' ? ORCHESTRATOR_ID : t.kind === 'prompt' ? t.agentId : undefined,
    folder: t.folder,
    interactive: false,
  });
  const existing = t.convId && getConversations().find((c) => c.id === t.convId);
  if (existing) {
    updateConversations((cs) => cs.map((c) => (c.id === existing.id ? ({ ...c, ...settingsFor(c) } as Conversation) : c)));
    return existing.id;
  }
  const conv = { id: uid(), systemPrompt: '', messages: [], updatedAt: Date.now(), ...settingsFor({}) } as Conversation;
  updateConversations((cs) => [conv, ...cs]);
  patchTask(t.id, { convId: conv.id });
  return conv.id;
}

const lastReply = (convId: string) => [...(getConversations().find((c) => c.id === convId)?.messages ?? [])].reverse().find((m) => m.role === 'assistant');

function notify(t: ScheduledTask, body: string, convId?: string) {
  if (!settings.notify || typeof Notification === 'undefined') return;
  try {
    const n = new Notification(`Penumbra · ${t.name}`, { body: body.replace(/\s+/g, ' ').slice(0, 180), silent: false });
    n.onclick = () => {
      host()?.showWindow();
      if (convId) openChatRequest.set(convId);
    };
  } catch {
    /* notifications unavailable */
  }
}

/** The run being logged, filled in as it goes. */
let current: { logId: string; msgId?: string; tools?: Record<string, number>; by?: string; approvals: { title: string; waitedMs: number }[] } = { logId: '', approvals: [] };

async function runCommand(t: ScheduledTask, convId: string) {
  const h = host();
  if (!h || !t.folder || !t.command) throw new Error('A command task needs a folder and a command');
  const user: UiMessage = { id: uid(), role: 'user', content: `Scheduled command in \`${t.folder}\`:\n\n\`\`\`sh\n${t.command}\n\`\`\`` };
  const reply: UiMessage = { id: uid(), role: 'assistant', content: 'Running…' };
  const add = (fn: (ms: UiMessage[]) => UiMessage[]) => updateConversations((cs) => cs.map((c) => (c.id === convId ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c)));
  add((ms) => [...ms, user, reply]);
  const r = await h.tools.run(t.folder, t.command, `task-${t.id}`, 600);
  const output = r.output.trim() || '(no output)';
  const ok = r.code === 0;
  const content = `${ok ? 'Finished' : r.signal ? `Stopped (${r.signal})` : `Exited with code ${r.code}`}.\n\n\`\`\`\n${output}\n\`\`\``;
  add((ms) => ms.map((m) => (m.id === reply.id ? { ...m, content, ...(ok ? {} : { error: `Exit code ${r.code ?? r.signal}` }) } : m)));
  current.msgId = reply.id;
  if (!ok) throw new Error(`Exited with code ${r.code ?? r.signal}`);
  return output;
}

async function runModel(t: ScheduledTask, convId: string) {
  const c = chatController.current;
  if (!c) throw new Error('The chat is not ready yet');
  if (t.kind === 'prompt' && t.agentId && !getAgent(t.agentId)) throw new Error('The agent for this task was deleted');
  const preApproved = t.preApproved.map((p) => APPROVAL_TOOLS[p]);
  await c.runInChat(convId, t.prompt, { preApproved });
  let reply = lastReply(convId);
  current.msgId = reply?.id;
  // Nobody is there to review the plan, so a scheduled orchestrator runs it right away.
  if (t.kind === 'orchestrator' && reply?.orchestration?.phase === 'review') {
    await new Promise((r) => setTimeout(r, 50));
    await chatController.current!.runPlan(reply.id, { preApproved });
    reply = lastReply(convId);
  }
  const o = reply?.orchestration;
  // Count the tools it used, including each orchestrator task's.
  const tools: Record<string, number> = {};
  for (const step of [...(reply?.steps ?? []), ...(o?.plan?.tasks.flatMap((x) => x.steps ?? []) ?? [])]) tools[step.tool] = (tools[step.tool] ?? 0) + 1;
  if (Object.keys(tools).length) current.tools = tools;
  if (o?.plan) current.by = `Orchestrator · ${t.model} → ${[...new Set(o.plan.tasks.map((x) => x.agent))].join(', ')}`;
  const error = reply?.error || (o && o.phase !== 'done' ? o.error || `The run ended in "${o.phase}"` : '') || (reply?.stopped ? 'Stopped' : '');
  if (error) throw new Error(error);
  return reply?.content ?? '';
}

async function runTask(t: ScheduledTask) {
  running = t.id;
  const now = Date.now();
  const trigger: RunLogEntry['trigger'] = manualRuns.delete(t.id) ? 'manual' : t.nextRun !== null && now - t.nextRun > 2 * 60000 ? 'missed' : 'schedule';
  const agent = t.kind === 'prompt' ? getAgent(t.agentId) : undefined;
  const by = t.kind === 'command' ? 'Command' : t.kind === 'orchestrator' ? `Orchestrator · ${t.model}` : agent ? `${agent.name} · ${agent.model}` : t.model;
  current = { logId: uid(), approvals: [] };
  saveLog([{ id: current.logId, taskId: t.id, startedAt: now, trigger, status: 'running', by }, ...log]);
  const finish = (patch: Partial<RunLogEntry>) =>
    patchLog(current.logId, (e) => ({
      ...e,
      ...patch,
      endedAt: Date.now(),
      msgId: current.msgId,
      ...(current.by ? { by: current.by } : {}),
      ...(current.tools ? { tools: current.tools } : {}),
      ...(current.approvals.length ? { approvals: current.approvals } : {}),
    }));
  // The next time is set before running, so a long run doesn't fire twice.
  patchTask(t.id, { lastStatus: 'running', lastError: undefined, lastRun: Date.now(), nextRun: nextAfter(t.schedule, Date.now()), ...(t.schedule.type === 'once' ? { enabled: false } : {}) });
  const convId = taskChat(t);
  try {
    const out = t.kind === 'command' ? await runCommand(t, convId) : await runModel(t, convId);
    patchTask(t.id, { lastStatus: 'ok' });
    // Plain text for the log: no Markdown symbols or code fences.
    const plain = out.replace(/```[a-z]*/gi, ' ').replace(/\*\*|__|`/g, '').replace(/^\s*(#{1,6}|>)\s+/gm, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
    finish({ status: 'ok', summary: plain.slice(0, 400) });
    notify(t, out || 'Finished.', convId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    patchTask(t.id, { lastStatus: 'error', lastError: msg });
    finish({ status: 'error', error: msg });
    notify(t, `Didn't finish: ${msg}`, convId);
  } finally {
    running = null;
    emit();
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (;;) {
      const now = Date.now();
      const due = tasks.filter((t) => t.enabled && t.nextRun !== null && t.nextRun <= now).sort((a, b) => a.nextRun! - b.nextRun!)[0];
      // One reply at a time: wait while the chat (or another task) is busy.
      if (!due || streaming.get() || !chatController.current) break;
      await runTask(due);
    }
  } finally {
    ticking = false;
  }
}

// A task waiting for an approval notifies you, since nobody may be looking at the window.
let notifiedFor: unknown = null;
approval.subscribe(() => {
  const a = approval.get();
  if (!a || a === notifiedFor || !running) return;
  const t = tasks.find((x) => x.id === running);
  if (!t || t.convId !== a.convId) return;
  notifiedFor = a;
  patchTask(t.id, { lastStatus: 'waiting' });
  notify(t, `Needs your OK: ${a.req.title}`, a.convId);
  const asked = Date.now();
  const logId = current.logId;
  const off = approval.subscribe(() => {
    if (approval.get() === a) return;
    off();
    // "Open a website? github.com" says more than the question alone.
    let detail = a.req.detail;
    try {
      if (/^https?:\/\//.test(detail)) detail = new URL(detail).hostname;
    } catch {
      /* not a full address; keep it as is */
    }
    if (current.logId === logId) current.approvals.push({ title: `${a.req.title} ${detail}`.trim().slice(0, 160), waitedMs: Date.now() - asked });
    if (running === t.id) patchTask(t.id, { lastStatus: 'running' });
  });
});

function syncTray() {
  const active = tasks.filter((t) => t.enabled && t.nextRun !== null);
  const soonest = [...active].sort((a, b) => a.nextRun! - b.nextRun!)[0];
  host()?.setTrayStatus({ enabled: settings.menuBar, active: active.length, next: soonest ? { name: soonest.name, when: describeWhen(soonest.nextRun!) } : null });
}

let started = false;
/** Starts the clock (once). Runs missed while the app was closed run once now. */
export function startScheduler() {
  if (started) return;
  started = true;
  // A run that was cut off by quitting isn't "running" anymore.
  if (tasks.some((t) => t.lastStatus === 'running' || t.lastStatus === 'waiting')) {
    saveTasks(tasks.map((t) => (t.lastStatus === 'running' || t.lastStatus === 'waiting' ? { ...t, lastStatus: 'error', lastError: 'Penumbra closed during the run' } : t)));
  }
  if (log.some((e) => e.status === 'running')) {
    saveLog(log.map((e) => (e.status === 'running' ? { ...e, status: 'error', error: 'Penumbra closed during the run' } : e)));
  }
  syncTray();
  setTimeout(tick, 3000);
  setInterval(() => {
    tick();
    syncTray(); // keeps "in 5 min" in the menu fresh
  }, TICK_MS);
  // When the chat frees up, a waiting task can go.
  streaming.subscribe(() => !streaming.get() && setTimeout(tick, 500));
}
