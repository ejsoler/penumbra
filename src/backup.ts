// What goes into a backup, and how a backup is merged back in. The main process (electron/backup.cjs)
// writes and reads the .zip and copies skill folders and image files; this side collects the chats,
// agents, scheduled tasks, and settings, and merges them into this profile's storage when restoring.
import type { Agent } from './agents/agents';
import { host, type OpenedBackup } from './host';
import type { RunLogEntry, ScheduledTask } from './scheduler';
import { getConversations, updateConversations } from './session';
import { uid, type Conversation } from './store';

const AGENTS_KEY = 'ollama-gui.agents';
const TASKS_KEY = 'ollama-gui.schedule';
const LOG_KEY = 'ollama-gui.scheduleLog';

/** Settings that are worth keeping, by what they are. Things like the open tab or a draft prompt are left out. */
export const SETTING_GROUPS: { id: string; label: string; keys: string[] }[] = [
  { id: 'chat', label: 'Chat settings (sampling and generation)', keys: ['ollama-gui.params', 'ollama-gui.showSettings'] },
  { id: 'internet', label: 'Internet access and your sites', keys: ['ollama-gui.widgetNet'] },
  { id: 'profile', label: 'Your name and avatar', keys: ['ollama-gui.profile'] },
  { id: 'server', label: 'Ollama server address', keys: ['ollama-gui.host'] },
  { id: 'other', label: 'Images, scheduler, skills, and update settings', keys: ['ollama-gui.imageModel', 'ollama-gui.imageSize', 'ollama-gui.imagesShowAdult', 'ollama-gui.scheduleSettings', 'ollama-gui.skillsDisabled', 'ollama-gui.updates', 'ollama-gui.tutorial'] },
];

const readList = <T,>(key: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const writeList = (key: string, list: unknown[]) => localStorage.setItem(key, JSON.stringify(list));

export const savedAgents = () => readList<Agent>(AGENTS_KEY);
export const savedTasks = () => readList<ScheduledTask>(TASKS_KEY);

/** Image files a chat shows (made by the image tool), so "images in these chats" can be picked. */
export const chatImages = (c: Conversation) => c.messages.flatMap((m) => m.generated?.map((g) => g.file) ?? []);

export interface BackupChoice {
  chats: string[];
  agents: string[];
  tasks: string[];
  skills: string[];
  images: string[];
  settings: string[];
}

export async function makeBackup(choice: BackupChoice, name?: string) {
  const pick = <T extends { id: string }>(list: T[], ids: string[]) => list.filter((x) => ids.includes(x.id));
  const tasks = pick(savedTasks(), choice.tasks);
  const settings: Record<string, string> = {};
  for (const g of SETTING_GROUPS.filter((g) => choice.settings.includes(g.id))) {
    for (const k of g.keys) {
      const v = localStorage.getItem(k);
      if (v !== null) settings[k] = v;
    }
  }
  return host()!.backup.save({
    data: {
      chats: pick(getConversations(), choice.chats),
      agents: pick(savedAgents(), choice.agents),
      tasks,
      taskLog: readList<RunLogEntry>(LOG_KEY).filter((e) => choice.tasks.includes(e.taskId)),
      settings,
    },
    skills: choice.skills,
    images: choice.images,
    name,
  });
}

/** Backs up one chat, with what it needs: its agent, that agent's skills, and the images it shows. */
export function backupChat(c: Conversation) {
  const agent = savedAgents().find((a) => a.id === c.agentId);
  return makeBackup(
    { chats: [c.id], agents: agent ? [agent.id] : [], tasks: [], skills: agent?.skills ?? [], images: chatImages(c), settings: [] },
    `${c.title || 'Chat'} backup`,
  );
}

/** What an opened backup offers, in the shape the restore choices use. */
export function backupContents(b: OpenedBackup) {
  const list = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  const settings = (b.data.settings && typeof b.data.settings === 'object' ? b.data.settings : {}) as Record<string, string>;
  return {
    chats: list<Conversation>(b.data.chats),
    agents: list<Agent>(b.data.agents),
    tasks: list<ScheduledTask>(b.data.tasks),
    taskLog: list<RunLogEntry>(b.data.taskLog),
    settings,
    settingGroups: SETTING_GROUPS.filter((g) => g.keys.some((k) => k in settings)),
  };
}

export interface RestoreReport {
  added: Record<'chats' | 'agents' | 'tasks' | 'skills' | 'images', number>;
  /** Already here, unchanged, so not added again. */
  skipped: number;
  settings: number;
}

/**
 * Adds the chosen items to this profile. Nothing already here is replaced: an item with the same id that
 * differs is added as a copy, and one that's identical is skipped. Chosen settings do replace the current ones.
 * Restored scheduled tasks start paused. The caller reloads the window afterwards.
 */
export async function restoreBackup(b: OpenedBackup, choice: BackupChoice): Promise<RestoreReport> {
  const c = backupContents(b);
  const files = await host()!.backup.restoreFiles({ skills: choice.skills, images: choice.images });
  const report: RestoreReport = { added: { chats: 0, agents: 0, tasks: 0, skills: 0, images: 0 }, skipped: files.skipped, settings: 0 };
  report.added.skills = Object.keys(files.skills).length;
  report.added.images = Object.keys(files.images).length;

  /** Same id here: skip it if it's the same, otherwise give the restored one a new id. */
  const place = <T extends { id: string }>(item: T, here: T[], same: (a: T, b: T) => boolean): T | null => {
    const existing = here.find((x) => x.id === item.id);
    if (!existing) return item;
    if (same(existing, item)) {
      report.skipped++;
      return null;
    }
    return { ...item, id: uid() };
  };
  const json = (x: unknown) => JSON.stringify(x);

  // Agents first: chats and tasks point at them.
  const agentIds: Record<string, string> = {};
  const agentsHere = savedAgents();
  const newAgents: Agent[] = [];
  for (const a of c.agents.filter((x) => choice.agents.includes(x.id))) {
    const placed = place(a, agentsHere, (x, y) => json(x) === json(y));
    if (!placed) continue;
    agentIds[a.id] = placed.id;
    newAgents.push({ ...placed, skills: (placed.skills ?? []).map((s) => files.skills[s] ?? s) });
  }
  if (newAgents.length) writeList(AGENTS_KEY, [...agentsHere, ...newAgents]);
  report.added.agents = newAgents.length;

  const chatIds: Record<string, string> = {};
  const chatsHere = getConversations();
  const newChats: Conversation[] = [];
  for (const conv of c.chats.filter((x) => choice.chats.includes(x.id))) {
    const placed = place(conv, chatsHere, (x, y) => x.updatedAt === y.updatedAt && x.messages.length === y.messages.length);
    if (!placed) continue;
    chatIds[conv.id] = placed.id;
    newChats.push({
      ...placed,
      title: placed.id === conv.id ? placed.title : `${placed.title} (restored)`,
      agentId: placed.agentId ? agentIds[placed.agentId] ?? placed.agentId : undefined,
      messages: placed.messages.map((m) => (m.generated ? { ...m, generated: m.generated.map((g) => ({ ...g, file: files.images[g.file] ?? g.file })) } : m)),
    });
  }
  if (newChats.length) updateConversations((cs) => [...newChats, ...cs]);
  report.added.chats = newChats.length;

  const tasksHere = savedTasks();
  const newTasks: ScheduledTask[] = [];
  const taskIds: Record<string, string> = {};
  for (const t of c.tasks.filter((x) => choice.tasks.includes(x.id))) {
    const placed = place(t, tasksHere, (x, y) => json({ ...x, nextRun: 0, lastRun: 0, lastStatus: 0 }) === json({ ...y, nextRun: 0, lastRun: 0, lastStatus: 0 }));
    if (!placed) continue;
    taskIds[t.id] = placed.id;
    newTasks.push({
      ...placed,
      enabled: false,
      nextRun: null,
      lastStatus: placed.lastStatus === 'running' || placed.lastStatus === 'waiting' ? undefined : placed.lastStatus,
      agentId: placed.agentId ? agentIds[placed.agentId] ?? placed.agentId : undefined,
      convId: placed.convId ? chatIds[placed.convId] ?? placed.convId : undefined,
    });
  }
  if (newTasks.length) {
    writeList(TASKS_KEY, [...tasksHere, ...newTasks]);
    const log = c.taskLog.filter((e) => taskIds[e.taskId]).map((e) => ({ ...e, id: uid(), taskId: taskIds[e.taskId], status: e.status === 'running' ? 'error' as const : e.status }));
    writeList(LOG_KEY, [...readList<RunLogEntry>(LOG_KEY), ...log]);
  }
  report.added.tasks = newTasks.length;

  for (const g of c.settingGroups.filter((g) => choice.settings.includes(g.id))) {
    for (const k of g.keys) {
      if (!(k in c.settings)) continue;
      localStorage.setItem(k, c.settings[k]);
      report.settings++;
    }
  }
  await host()!.backup.close();
  return report;
}
