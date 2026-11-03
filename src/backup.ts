// What goes into a backup, and how a backup is merged back in. The main process (electron/backup.cjs)
// writes and reads the .zip and copies skill folders and image files; this side collects the chats,
// agents, scheduled tasks, and settings, and merges them into this profile's storage when restoring.
//
// A full backup has everything; an incremental one has only what's new or changed since each item was last
// backed up. Each backup records a fingerprint of every item it saved (BASE_KEY) to tell what changed.
import type { Agent } from './agents/agents';
import { host, type BackupSkill, type OpenedBackup } from './host';
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
export type BackupKind = 'full' | 'incremental';
const KINDS = ['chats', 'agents', 'tasks', 'skills', 'images', 'settings'] as const;
export const choiceSize = (c: BackupChoice) => KINDS.reduce((n, k) => n + c[k].length, 0);

/** When this profile last saved a backup (shown on Home). */
export const LAST_BACKUP_KEY = 'ollama-gui.lastBackup';
export const lastBackup = () => Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0;

// ---- what changed --------------------------------------------------------------------------------

/** Each item's fingerprint when it was last backed up, by kind and id. */
type Fingerprints = Record<(typeof KINDS)[number], Record<string, string>>;
const BASE_KEY = 'ollama-gui.backupBase';
const emptyPrints = (): Fingerprints => ({ chats: {}, agents: {}, tasks: {}, skills: {}, images: {}, settings: {} });
const readBase = (): Fingerprints => {
  try {
    return { ...emptyPrints(), ...JSON.parse(localStorage.getItem(BASE_KEY) || '{}') };
  } catch {
    return emptyPrints();
  }
};

/** Short hash (FNV-1a) of a string. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + s.length.toString(36);
}
/** A task changes when its settings do, not each time it runs. */
const taskPrint = (t: ScheduledTask) => hash(JSON.stringify({ ...t, nextRun: 0, lastRun: 0, lastStatus: 0, lastError: 0, convId: 0 }));
const settingPrint = (keys: string[]) => hash(keys.map((k) => localStorage.getItem(k) ?? '').join('\u0000'));

/** Fingerprints of everything in this profile now. */
function currentPrints(files: { skills: BackupSkill[]; images: { file: string }[] }): Fingerprints {
  const p = emptyPrints();
  for (const c of getConversations()) if (c.messages.length) p.chats[c.id] = `${c.updatedAt}:${c.messages.length}`;
  for (const a of savedAgents()) p.agents[a.id] = hash(JSON.stringify(a));
  for (const t of savedTasks()) p.tasks[t.id] = taskPrint(t);
  for (const s of files.skills) p.skills[s.id] = s.hash ?? s.id;
  for (const i of files.images) p.images[i.file] = '1';
  for (const g of SETTING_GROUPS) if (g.keys.some((k) => localStorage.getItem(k) !== null)) p.settings[g.id] = settingPrint(g.keys);
  return p;
}

/** Everything in this profile (a full backup), or what's new or changed since it was last backed up (incremental). */
export async function backupChoiceFor(kind: BackupKind): Promise<{ choice: BackupChoice; since: number }> {
  const files = await host()!.backup.summary();
  const now = currentPrints(files);
  const base = readBase();
  const choice = {} as BackupChoice;
  for (const k of KINDS) choice[k] = Object.keys(now[k]).filter((id) => kind === 'full' || base[k][id] !== now[k][id]);
  return { choice, since: kind === 'incremental' ? lastBackup() : 0 };
}

/** After a backup: remember what it saved, so the next incremental one leaves it out unless it changes. */
async function recordBackup(choice: BackupChoice) {
  const now = currentPrints(await host()!.backup.summary());
  const base = readBase();
  for (const k of KINDS) for (const id of choice[k]) if (now[k][id]) base[k][id] = now[k][id];
  localStorage.setItem(BASE_KEY, JSON.stringify(base));
  localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
}

// ---- backing up ----------------------------------------------------------------------------------

/**
 * Saves a backup of the chosen items. `dir` saves it there without asking (scheduled backups); otherwise
 * the user picks where. Backups from the Backup tab and the scheduler are recorded for incremental backups;
 * a single chat's backup isn't.
 */
export async function makeBackup(choice: BackupChoice, opts: { name?: string; kind?: BackupKind; dir?: string; record?: boolean } = {}) {
  const pick = <T extends { id: string }>(list: T[], ids: string[]) => list.filter((x) => ids.includes(x.id));
  const settings: Record<string, string> = {};
  for (const g of SETTING_GROUPS.filter((g) => choice.settings.includes(g.id))) {
    for (const k of g.keys) {
      const v = localStorage.getItem(k);
      if (v !== null) settings[k] = v;
    }
  }
  const r = await host()!.backup.save({
    data: {
      chats: pick(getConversations(), choice.chats),
      agents: pick(savedAgents(), choice.agents),
      tasks: pick(savedTasks(), choice.tasks),
      taskLog: readList<RunLogEntry>(LOG_KEY).filter((e) => choice.tasks.includes(e.taskId)),
      settings,
    },
    skills: choice.skills,
    images: choice.images,
    name: opts.name,
    kind: opts.kind,
    dir: opts.dir,
  });
  if (r && opts.record !== false) await recordBackup(choice);
  return r;
}

/** Backs up one chat, with what it needs: its agent, that agent's skills, and the images it shows. */
export function backupChat(c: Conversation) {
  const agent = savedAgents().find((a) => a.id === c.agentId);
  return makeBackup(
    { chats: [c.id], agents: agent ? [agent.id] : [], tasks: [], skills: agent?.skills ?? [], images: chatImages(c), settings: [] },
    { name: `${c.title || 'Chat'} backup`, record: false },
  );
}

/** A scheduled backup into `dir`. Null when it's incremental and nothing changed. */
export async function scheduledBackup(kind: BackupKind, dir: string) {
  const { choice } = await backupChoiceFor(kind);
  const count = choiceSize(choice);
  if (!count) return null;
  const r = await makeBackup(choice, { kind, dir });
  return r && { ...r, count, choice };
}

// ---- restoring -----------------------------------------------------------------------------------

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
  /** Items here replaced by the backup's version. */
  replaced: number;
  /** Already here, unchanged, so not added again. */
  skipped: number;
  settings: number;
}

/**
 * Adds the chosen items to this profile. An identical item already here is skipped. One with the same id that
 * differs is added as a copy, or with `replace` (for restoring incremental backups in order) takes the place of
 * the one here. Chosen settings replace the current ones. Restored scheduled tasks start paused. The caller
 * reloads the window afterwards.
 */
export async function restoreBackup(b: OpenedBackup, choice: BackupChoice, replace = false): Promise<RestoreReport> {
  const c = backupContents(b);
  const files = await host()!.backup.restoreFiles({ skills: choice.skills, images: choice.images, replace });
  const report: RestoreReport = { added: { chats: 0, agents: 0, tasks: 0, skills: 0, images: 0 }, replaced: files.replaced ?? 0, skipped: files.skipped, settings: 0 };
  report.added.skills = Object.keys(files.skills).length - report.replaced;
  report.added.images = Object.keys(files.images).length;

  /** Same id here: skip it if it's the same, replace it, or give the restored one a new id. */
  const place = <T extends { id: string }>(item: T, here: T[], same: (a: T, b: T) => boolean): { item: T; replaces: boolean } | null => {
    const existing = here.find((x) => x.id === item.id);
    if (!existing) return { item, replaces: false };
    if (same(existing, item)) {
      report.skipped++;
      return null;
    }
    if (replace) {
      report.replaced++;
      return { item, replaces: true };
    }
    return { item: { ...item, id: uid() }, replaces: false };
  };
  /** The list with replaced items swapped in place and new ones added. */
  const merge = <T extends { id: string }>(here: T[], placed: { item: T; replaces: boolean }[], first = false) => {
    const swaps = new Map(placed.filter((p) => p.replaces).map((p) => [p.item.id, p.item]));
    const added = placed.filter((p) => !p.replaces).map((p) => p.item);
    const kept = here.map((x) => swaps.get(x.id) ?? x);
    return first ? [...added, ...kept] : [...kept, ...added];
  };
  const json = (x: unknown) => JSON.stringify(x);

  // Agents first: chats and tasks point at them.
  const agentIds: Record<string, string> = {};
  const agentsHere = savedAgents();
  const agents: { item: Agent; replaces: boolean }[] = [];
  for (const a of c.agents.filter((x) => choice.agents.includes(x.id))) {
    const p = place(a, agentsHere, (x, y) => json(x) === json(y));
    if (!p) continue;
    agentIds[a.id] = p.item.id;
    agents.push({ ...p, item: { ...p.item, skills: (p.item.skills ?? []).map((s) => files.skills[s] ?? s) } });
  }
  if (agents.length) writeList(AGENTS_KEY, merge(agentsHere, agents));
  report.added.agents = agents.filter((p) => !p.replaces).length;

  const chatIds: Record<string, string> = {};
  const chatsHere = getConversations();
  const chats: { item: Conversation; replaces: boolean }[] = [];
  for (const conv of c.chats.filter((x) => choice.chats.includes(x.id))) {
    const p = place(conv, chatsHere, (x, y) => x.updatedAt === y.updatedAt && x.messages.length === y.messages.length);
    if (!p) continue;
    chatIds[conv.id] = p.item.id;
    const copy = p.item.id !== conv.id;
    chats.push({
      ...p,
      item: {
        ...p.item,
        title: copy ? `${p.item.title} (restored)` : p.item.title,
        agentId: p.item.agentId ? agentIds[p.item.agentId] ?? p.item.agentId : undefined,
        messages: p.item.messages.map((m) => (m.generated ? { ...m, generated: m.generated.map((g) => ({ ...g, file: files.images[g.file] ?? g.file })) } : m)),
      },
    });
  }
  if (chats.length) updateConversations((cs) => merge(cs, chats, true));
  report.added.chats = chats.filter((p) => !p.replaces).length;

  const tasksHere = savedTasks();
  const tasks: { item: ScheduledTask; replaces: boolean }[] = [];
  const taskIds: Record<string, string> = {};
  for (const t of c.tasks.filter((x) => choice.tasks.includes(x.id))) {
    const p = place(t, tasksHere, (x, y) => taskPrint(x) === taskPrint(y));
    if (!p) continue;
    taskIds[t.id] = p.item.id;
    tasks.push({
      ...p,
      item: {
        ...p.item,
        enabled: false,
        nextRun: null,
        lastStatus: p.item.lastStatus === 'running' || p.item.lastStatus === 'waiting' ? undefined : p.item.lastStatus,
        agentId: p.item.agentId ? agentIds[p.item.agentId] ?? p.item.agentId : undefined,
        convId: p.item.convId ? chatIds[p.item.convId] ?? p.item.convId : undefined,
      },
    });
  }
  if (tasks.length) {
    writeList(TASKS_KEY, merge(tasksHere, tasks));
    const logHere = readList<RunLogEntry>(LOG_KEY);
    const known = new Set(logHere.map((e) => e.id));
    // A replaced task keeps its log; entries the backup has that aren't here yet are added.
    const log = c.taskLog
      .filter((e) => taskIds[e.taskId] && !(taskIds[e.taskId] === e.taskId && known.has(e.id)))
      .map((e) => ({ ...e, id: taskIds[e.taskId] === e.taskId ? e.id : uid(), taskId: taskIds[e.taskId], status: e.status === 'running' ? 'error' as const : e.status }));
    writeList(LOG_KEY, [...logHere, ...log]);
  }
  report.added.tasks = tasks.filter((p) => !p.replaces).length;

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
