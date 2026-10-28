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

export interface SchedulerSettings {
  /** Stay in the menu bar when the window closes, while any task is on. */
  menuBar: boolean;
  notify: boolean;
}

const TASKS_KEY = 'ollama-gui.schedule';
const SETTINGS_KEY = 'ollama-gui.scheduleSettings';
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
let running = null as string | null;
let snapshot: { tasks: ScheduledTask[]; settings: SchedulerSettings; running: string | null } = { tasks, settings, running };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { tasks, settings, running };
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

export const deleteTask = (id: string) => saveTasks(tasks.filter((t) => t.id !== id));

/** Due now, regardless of its schedule; runs as soon as nothing else is. */
export function runTaskNow(id: string) {
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
  // Nobody is there to review the plan, so a scheduled orchestrator runs it right away.
  if (t.kind === 'orchestrator' && reply?.orchestration?.phase === 'review') {
    await new Promise((r) => setTimeout(r, 50));
    await chatController.current!.runPlan(reply.id, { preApproved });
    reply = lastReply(convId);
  }
  const o = reply?.orchestration;
  const error = reply?.error || (o && o.phase !== 'done' ? o.error || `The run ended in "${o.phase}"` : '') || (reply?.stopped ? 'Stopped' : '');
  if (error) throw new Error(error);
  return reply?.content ?? '';
}

async function runTask(t: ScheduledTask) {
  running = t.id;
  // The next time is set before running, so a long run doesn't fire twice.
  patchTask(t.id, { lastStatus: 'running', lastError: undefined, lastRun: Date.now(), nextRun: nextAfter(t.schedule, Date.now()), ...(t.schedule.type === 'once' ? { enabled: false } : {}) });
  const convId = taskChat(t);
  try {
    const out = t.kind === 'command' ? await runCommand(t, convId) : await runModel(t, convId);
    patchTask(t.id, { lastStatus: 'ok' });
    notify(t, out || 'Finished.', convId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    patchTask(t.id, { lastStatus: 'error', lastError: msg });
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
  const off = approval.subscribe(() => {
    if (approval.get() === a) return;
    off();
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
  syncTray();
  setTimeout(tick, 3000);
  setInterval(() => {
    tick();
    syncTray(); // keeps "in 5 min" in the menu fresh
  }, TICK_MS);
  // When the chat frees up, a waiting task can go.
  streaming.subscribe(() => !streaming.get() && setTimeout(tick, 500));
}
