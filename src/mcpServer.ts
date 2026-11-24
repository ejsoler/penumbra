// Penumbra as an MCP server, the window's side: the settings (what other apps may do, and whether to ask
// first), starting the server in the main process (electron/mcp-server.cjs), and doing each tool's work with
// the chats, projects, models, and images that live here.
import { useSyncExternalStore } from 'react';
import * as api from './api';
import { getAgents } from './agents/agents';
import { ORCHESTRATOR_ID } from './agents/orchestrator';
import { host, type McpCap, type McpServerConfig, type McpServerResult } from './host';
import { generateImage, imageModelFor, modelLabel } from './images';
import { getUserMemory, searchMessages } from './memory';
import { createProject, getProject, getProjects, MAX_PROJECT_SOURCES, MAX_SOURCE, sourcesSize, updateProject } from './projects';
import { approval, chatController, getConversations, openChatRequest, streaming, updateConversations } from './session';
import { uid, type Conversation } from './store';
import { newChatNet } from './widgets/network';

export const CAPS: { id: McpCap; label: string; description: string; tools: string[] }[] = [
  { id: 'ask', label: 'Ask models and agents', description: 'Send a message to a local model or an agent and get its answer. It is saved as a chat here.', tools: ['list_models', 'list_agents', 'ask'] },
  { id: 'read', label: 'Read and search chats', description: 'List, read, and search chats, projects, and the notes Penumbra keeps. Read only.', tools: ['list_chats', 'read_chat', 'search_chats', 'list_projects', 'read_project', 'read_memory'] },
  { id: 'projects', label: 'Manage projects', description: 'Create projects, change their instructions, add source files, and move chats into them.', tools: ['create_project', 'update_project', 'add_project_source', 'move_chat'] },
  { id: 'images', label: 'Images and the orchestrator', description: 'Make pictures with your image model, and give goals to the orchestrator and its agents.', tools: ['generate_image', 'run_orchestrator'] },
];

export interface McpServerSettings {
  enabled: boolean;
  port: number;
  token: string;
  caps: Record<McpCap, boolean>;
  confirm: Record<McpCap, boolean>;
  allowed: string[];
}

export const MCP_SERVER_KEY = 'ollama-gui.mcpServer';
const DEFAULTS: McpServerSettings = {
  enabled: false,
  port: 8765,
  token: '',
  // Everything starts off: the user decides what other apps may do.
  caps: { ask: false, read: false, projects: false, images: false },
  confirm: { ask: true, read: false, projects: true, images: true },
  allowed: [],
};

let settings: McpServerSettings = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(MCP_SERVER_KEY) || '{}');
    return { ...DEFAULTS, ...raw, caps: { ...DEFAULTS.caps, ...raw.caps }, confirm: { ...DEFAULTS.confirm, ...raw.confirm } };
  } catch {
    return DEFAULTS;
  }
})();
let status: { running: boolean; error: string; port: number; clients: string[]; bridge: string; exe: string } = { running: false, error: '', port: 0, clients: [], bridge: '', exe: '' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useMcpServerSettings = () => useSyncExternalStore(subscribe, () => settings);
export const useMcpServerStatus = () => useSyncExternalStore(subscribe, () => status);

const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
const configOf = (s: McpServerSettings): McpServerConfig => ({ port: s.port, token: s.token, caps: s.caps, confirm: s.confirm, allowed: s.allowed });

function save(next: McpServerSettings) {
  settings = next;
  try {
    localStorage.setItem(MCP_SERVER_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  emit();
}

export async function refreshMcpServerStatus() {
  const h = host();
  if (!h) return;
  status = await h.mcpServer.status().catch(() => status);
  emit();
}

async function start() {
  const h = host();
  if (!h) return;
  if (!settings.token) save({ ...settings, token: newToken() });
  const r = await h.mcpServer.start(configOf(settings));
  status = { ...status, running: r.running, error: r.error, port: r.port };
  emit();
  await refreshMcpServerStatus();
}

/** Changes a setting, and applies it to the running server (a new port or turning it on restarts it). */
export async function setMcpServerSettings(patch: Partial<McpServerSettings>) {
  const before = settings;
  save({ ...settings, ...patch, caps: { ...settings.caps, ...patch.caps }, confirm: { ...settings.confirm, ...patch.confirm } });
  const h = host();
  if (!h) return;
  if (!settings.enabled) {
    if (before.enabled) await h.mcpServer.stop();
    return refreshMcpServerStatus();
  }
  if (!before.enabled || before.port !== settings.port) return start();
  await h.mcpServer.update(configOf(settings));
}

export const regenerateToken = () => setMcpServerSettings({ token: newToken() });

// ---- running a tool ----------------------------------------------------------------------------------

const ok = (text: string, images?: McpServerResult['images']): McpServerResult => ({ text, ...(images?.length ? { images } : {}) });
const fail = (text: string): McpServerResult => ({ text, isError: true });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const ago = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 16);

const chatLine = (c: Conversation) => `- ${c.id} · ${c.title} · ${c.model || 'no model'}${getProject(c.projectId) ? ` · project “${getProject(c.projectId)!.name}” (${c.projectId})` : ''} · ${c.messages.length} messages · ${ago(c.updatedAt)}`;
const lastReply = (id: string) => [...(getConversations().find((c) => c.id === id)?.messages ?? [])].reverse().find((m) => m.role === 'assistant');

/** If the run needs the user's OK for something (a command, a site), show them the chat it is in. */
function watchApprovals(convId: string) {
  let shown = false;
  const timer = setInterval(() => {
    if (!shown && approval.get()?.convId === convId) {
      shown = true;
      openChatRequest.set(convId);
      void host()?.mcpServer.focus();
    }
  }, 700);
  return () => clearInterval(timer);
}

/** A model that can chat (not an embedding or speech model). */
async function canChat(name: string, needsTools: boolean) {
  const caps = (await api.showModel(name).catch(() => null))?.capabilities ?? [];
  return caps.includes('completion') && !caps.includes('embedding') && (!needsTools || caps.includes('tools'));
}

async function pickModel(wanted: unknown, needsTools = false): Promise<string> {
  const models = await api.listModels();
  if (wanted) {
    const w = String(wanted);
    const m = models.find((x) => x.name === w) ?? models.find((x) => x.name.split(':')[0] === w);
    if (!m) throw new Error(`No installed model "${w}". Installed: ${models.map((x) => x.name).join(', ')}`);
    return m.name;
  }
  // The model the user chats with most recently first, then the rest (local ones before cloud).
  const recent = [...getConversations()].sort((x, y) => y.updatedAt - x.updatedAt).map((x) => x.model);
  const names = [...new Set([...recent, ...[...models].sort((x, y) => Number(!!x.remote_host) - Number(!!y.remote_host)).map((x) => x.name)])].filter((n) => models.some((m) => m.name === n));
  for (const name of names.slice(0, 10)) {
    if (models.find((m) => m.name === name)?.remote_host && names.some((n) => !models.find((m) => m.name === n)?.remote_host)) continue; // cloud only if nothing local fits
    if (await canChat(name, needsTools)) return name;
  }
  return '';
}

function newChat(fields: Partial<Conversation>): Conversation {
  const conv: Conversation = { id: uid(), title: 'MCP', model: '', systemPrompt: '', messages: [], updatedAt: Date.now(), interactive: false, net: newChatNet(), ...fields };
  updateConversations((cs) => [conv, ...cs]);
  return conv;
}

/** A saved image, as a small JPEG for the answer. */
async function pictureOf(dataUrl: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

async function runTool(tool: string, a: Record<string, unknown>, client: string, signal: AbortSignal): Promise<McpServerResult> {
  const c = chatController.current;
  switch (tool) {
    // ---- ask ----
    case 'list_models': {
      const models = await api.listModels();
      return ok(models.map((m) => `- ${m.name}${m.details.parameter_size ? ` (${m.details.parameter_size})` : ''}${m.remote_host ? ' · cloud' : ''}`).join('\n') || 'No models installed.');
    }
    case 'list_agents':
      return ok(getAgents().map((g) => `- ${g.name} (${g.model || 'no model'}): ${g.description || g.instructions.slice(0, 100)}`).join('\n') || 'No agents yet.');
    case 'ask': {
      const prompt = text(a.prompt);
      if (!prompt) return fail('Give a prompt.');
      if (!c) return fail("Penumbra's chat isn't ready yet.");
      if (streaming.get()) return fail('Penumbra is writing another reply right now. Try again in a moment.');
      const agent = a.agent ? getAgents().find((g) => g.name.toLowerCase() === text(a.agent).toLowerCase()) : undefined;
      if (a.agent && !agent) return fail(`No agent named "${text(a.agent)}". Agents: ${getAgents().map((g) => g.name).join(', ') || 'none'}.`);
      if (a.project_id && !getProject(text(a.project_id))) return fail(`No project with id "${text(a.project_id)}".`);
      const wanted = Array.isArray(a.tools) ? a.tools.map(String) : [];
      const extra = wanted.filter((t): t is 'files' | 'web' => t === 'files' || t === 'web');
      if (wanted.length !== extra.length) return fail('Only the read-only tools "files" and "web" can be used from here.');
      const folder = text(a.folder);
      if (folder && !/^([/~]|[A-Za-z]:[\\/])/.test(folder)) return fail('The folder must be a full path.');
      if (extra.includes('files') && !folder) return fail('The "files" tool needs a folder.');
      let convId = text(a.chat_id);
      if (convId) {
        if (!getConversations().some((x) => x.id === convId)) return fail(`No chat with id "${convId}".`);
      } else {
        const model = agent?.model || (await pickModel(a.model, extra.length > 0));
        if (!model) return fail('No models are installed in Ollama.');
        convId = newChat({
          title: `MCP · ${client}: ${clip(prompt, 36)}`,
          model,
          ...(agent ? { agentId: agent.id } : {}),
          ...(a.project_id ? { projectId: text(a.project_id) } : {}),
          ...(folder ? { folder } : {}),
          ...(extra.length ? { tools: ['skills', ...extra] } : {}),
        }).id;
      }
      const stop = watchApprovals(convId);
      const onAbort = () => c.stop();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await c.runInChat(convId, prompt, { fresh: false });
      } finally {
        stop();
        signal.removeEventListener('abort', onAbort);
      }
      const reply = lastReply(convId);
      if (!reply || reply.error) return fail(reply?.error || 'No answer.');
      return ok(`${reply.content.trim() || '(empty answer)'}\n\n[chat id: ${convId}]`);
    }

    // ---- read ----
    case 'list_chats': {
      const q = text(a.query).toLowerCase();
      const list = [...getConversations()]
        .filter((x) => (!q || x.title.toLowerCase().includes(q)) && (!a.project_id || x.projectId === text(a.project_id)))
        .sort((x, y) => y.updatedAt - x.updatedAt)
        .slice(0, Math.max(1, Math.min(200, Number(a.limit) || 30)));
      return ok(list.map(chatLine).join('\n') || 'No chats.');
    }
    case 'read_chat': {
      const conv = getConversations().find((x) => x.id === text(a.chat_id));
      if (!conv) return fail(`No chat with id "${text(a.chat_id)}".`);
      const from = Math.max(0, Number(a.offset) || 0);
      const part = conv.messages.slice(from, from + Math.max(1, Math.min(200, Number(a.limit) || 40)));
      const body = part.map((m, i) => `#${from + i + 1} ${m.role}: ${clip(m.content, 4000)}${m.files?.length ? ` [files: ${m.files.map((f) => f.name).join(', ')}]` : ''}`).join('\n\n');
      return ok(`${conv.title} (${conv.messages.length} messages, showing ${from + 1}–${from + part.length})\n\n${clip(body, 40000) || '(no messages)'}`);
    }
    case 'search_chats': {
      const out: string[] = [];
      const limit = Math.max(1, Math.min(50, Number(a.limit) || 10));
      for (const conv of [...getConversations()].sort((x, y) => y.updatedAt - x.updatedAt)) {
        for (const h of searchMessages(conv.messages, text(a.query), 2)) out.push(`${conv.id} · ${conv.title} · #${h.index} (${h.role}): ${h.text}`);
        if (out.length >= limit) break;
      }
      return ok(out.slice(0, limit).join('\n\n') || 'Nothing matches.');
    }
    case 'list_projects':
      return ok(getProjects().map((p) => `- ${p.id} · ${p.name} · ${getConversations().filter((x) => x.projectId === p.id).length} chats · ${p.sources.length} sources${p.folder ? ` · folder ${p.folder}` : ''}`).join('\n') || 'No projects.');
    case 'read_project': {
      const p = getProject(text(a.project_id));
      if (!p) return fail(`No project with id "${text(a.project_id)}".`);
      const chats = getConversations().filter((x) => x.projectId === p.id);
      return ok([
        `# ${p.name}`,
        p.folder ? `Folder: ${p.folder}` : '',
        p.instructions.trim() ? `Instructions:\n${p.instructions.trim()}` : 'No instructions.',
        `Sources (${p.sources.length}):\n${p.sources.map((s) => `- ${s.name} (${s.text.length} characters)`).join('\n') || '(none)'}`,
        `Notes:\n${(p.memory ?? []).map((m) => `- (${m.kind}) ${m.text}`).join('\n') || '(none)'}`,
        `Chats (${chats.length}):\n${chats.map(chatLine).join('\n') || '(none)'}`,
      ].filter(Boolean).join('\n\n'));
    }
    case 'read_memory': {
      const scope = text(a.scope);
      const items = scope === 'user' ? getUserMemory() : scope === 'project' ? getProject(text(a.id))?.memory : scope === 'chat' ? getConversations().find((x) => x.id === text(a.id))?.memory : undefined;
      if (scope !== 'user' && !text(a.id)) return fail('Give the id of the project or chat.');
      return ok((items ?? []).map((m) => `- (${m.kind}) ${m.text}`).join('\n') || 'No notes.');
    }

    // ---- projects ----
    case 'create_project': {
      const name = text(a.name);
      if (!name) return fail('Give a name.');
      const folder = text(a.folder);
      if (folder && !/^([/~]|[A-Za-z]:[\\/])/.test(folder)) return fail('The folder must be a full path.');
      const p = createProject({ name: name.slice(0, 80), instructions: text(a.instructions), ...(folder ? { folder } : {}) });
      return ok(`Created the project “${p.name}” (id ${p.id}).`);
    }
    case 'update_project': {
      const p = getProject(text(a.project_id));
      if (!p) return fail(`No project with id "${text(a.project_id)}".`);
      const patch: { name?: string; instructions?: string } = {};
      if (a.name !== undefined && text(a.name)) patch.name = text(a.name).slice(0, 80);
      if (a.instructions !== undefined) patch.instructions = String(a.instructions);
      if (!Object.keys(patch).length) return fail('Nothing to change: give a name or instructions.');
      updateProject(p.id, patch);
      return ok(`Updated “${patch.name ?? p.name}”.`);
    }
    case 'add_project_source': {
      const p = getProject(text(a.project_id));
      if (!p) return fail(`No project with id "${text(a.project_id)}".`);
      const body = String(a.text ?? '');
      if (!text(a.name) || !body.trim()) return fail('Give a name and the text.');
      if (body.length > MAX_SOURCE) return fail(`A source can be up to ${MAX_SOURCE / 1024} KB.`);
      if (sourcesSize(p) + body.length > MAX_PROJECT_SOURCES) return fail('This project has no room for more source text.');
      const saved = updateProject(p.id, (x) => ({ sources: [...x.sources, { id: uid(), name: text(a.name).slice(0, 80), text: body, addedAt: Date.now() }] }));
      return saved ? ok(`Added “${text(a.name)}” to “${p.name}”.`) : fail("Couldn't save: Penumbra's storage is full.");
    }
    case 'move_chat': {
      const conv = getConversations().find((x) => x.id === text(a.chat_id));
      if (!conv) return fail(`No chat with id "${text(a.chat_id)}".`);
      const projectId = text(a.project_id);
      if (projectId && !getProject(projectId)) return fail(`No project with id "${projectId}".`);
      updateConversations((cs) => cs.map((x) => (x.id === conv.id ? { ...x, projectId: projectId || undefined } : x)));
      return ok(projectId ? `Moved “${conv.title}” into “${getProject(projectId)!.name}”.` : `Took “${conv.title}” out of its project.`);
    }

    // ---- images and the orchestrator ----
    case 'generate_image': {
      const prompt = text(a.prompt);
      if (!prompt) return fail('Give a prompt.');
      const model = await imageModelFor();
      if (!model) return fail('No image model is installed in Penumbra (Images tab).');
      const size = (v: unknown) => Math.max(256, Math.min(1536, Math.round((Number(v) || 1024) / 64) * 64));
      const stop = () => void host()?.images.stop();
      signal.addEventListener('abort', stop, { once: true });
      try {
        const r = await generateImage({ id: model.id, prompt, width: size(a.width), height: size(a.height) });
        const pic = r.image ? await pictureOf(r.image) : null;
        return ok(`Made a ${r.width}×${r.height} image with ${modelLabel(model)} (seed ${r.seed}). It is saved in Penumbra's Images.`, pic ? [pic] : undefined);
      } finally {
        signal.removeEventListener('abort', stop);
      }
    }
    case 'run_orchestrator': {
      const goal = text(a.goal);
      if (!goal) return fail('Give a goal.');
      if (!c) return fail("Penumbra's chat isn't ready yet.");
      if (streaming.get()) return fail('Penumbra is writing another reply right now. Try again in a moment.');
      const model = await pickModel(a.model, true);
      if (!model) return fail('No models are installed in Ollama.');
      const folder = text(a.folder);
      const conv = newChat({ title: `MCP · ${client}: ${clip(goal, 36)}`, model, agentId: ORCHESTRATOR_ID, ...(folder ? { folder } : {}) });
      const stop = watchApprovals(conv.id);
      const onAbort = () => c.stop();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await c.runInChat(conv.id, goal, { fresh: false });
        let reply = lastReply(conv.id);
        // Nobody reviews the plan here, so it runs right away; tools still ask the user.
        if (reply?.orchestration?.phase === 'review') {
          await new Promise((r) => setTimeout(r, 50));
          await c.runPlan(reply.id, {});
          reply = lastReply(conv.id);
        }
        const o = reply?.orchestration;
        const error = reply?.error || (o && o.phase !== 'done' ? o.error || `The run ended in "${o.phase}".` : '');
        if (error) return fail(error);
        return ok(`${reply?.content.trim() || '(empty answer)'}\n\n[chat id: ${conv.id}]`);
      } finally {
        stop();
        signal.removeEventListener('abort', onAbort);
      }
    }
  }
  return fail(`Unknown tool "${tool}".`);
}

// ---- wiring ------------------------------------------------------------------------------------------

/** At startup: handle calls from the main process, and start the server if it's turned on. */
export function startMcpServer() {
  const h = host();
  if (!h) return () => {};
  const running = new Map<string, AbortController>();
  const offCall = h.mcpServer.onCall(async (id, call) => {
    const ac = new AbortController();
    running.set(id, ac);
    try {
      h.mcpServer.reply(id, await runTool(call.tool, call.args, call.client, ac.signal));
    } catch (e) {
      h.mcpServer.reply(id, fail(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
    } finally {
      running.delete(id);
    }
  });
  const offCancel = h.mcpServer.onCancel((id) => running.get(id)?.abort());
  const offAllowed = h.mcpServer.onAllowed((tool) => save({ ...settings, allowed: [...new Set([...settings.allowed, tool])] }));
  if (settings.enabled) void start();
  return () => {
    offCall();
    offCancel();
    offAllowed();
  };
}
