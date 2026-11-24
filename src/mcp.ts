// MCP servers (Model Context Protocol): other apps and programs Penumbra connects to, whose tools chats and
// agents can then use. The list is stored per profile; the main process (electron/mcp.cjs) starts the
// servers and talks to them. A tool from a server asks the user before it runs, once or always.
import { useSyncExternalStore } from 'react';
import { host, type McpToolInfo } from './host';
import { uid } from './store';
import { Declined, type Tool } from './agents/tools';

export interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  /** stdio: the program that starts the server, and its arguments. */
  command: string;
  args: string[];
  /** Extra environment variables for the program (API keys, for example). */
  env: Record<string, string>;
  /** http: the server's address, and headers such as an Authorization key. */
  url: string;
  headers: Record<string, string>;
  /** Connect when Penumbra starts. */
  enabled: boolean;
  /** Tools the user chose "always allow" for. */
  allowed: string[];
  /** How long to wait for one tool, in seconds (a server that reports progress gets more). Missing means 5 minutes. */
  timeoutSec?: number;
  createdAt: number;
}

export type McpStatus = 'off' | 'connecting' | 'on' | 'error';
export interface McpRuntime {
  status: McpStatus;
  tools: McpToolInfo[];
  info?: { name?: string; version?: string; instructions?: string } | null;
  error?: string;
}

export const MCP_KEY = 'ollama-gui.mcpServers';
export const DEFAULT_TIMEOUT = 300;

let servers: McpServer[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(MCP_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
})();
let runtime: Record<string, McpRuntime> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function saveServers(next: McpServer[]) {
  servers = next;
  try {
    localStorage.setItem(MCP_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  emit();
}
const setRuntime = (id: string, r: McpRuntime) => {
  runtime = { ...runtime, [id]: r };
  emit();
};

export const useMcpServers = () => useSyncExternalStore(subscribe, () => servers);
export const useMcpRuntime = () => useSyncExternalStore(subscribe, () => runtime);
export const getMcpServers = () => servers;
export const runtimeOf = (id: string): McpRuntime => runtime[id] ?? { status: 'off', tools: [] };

export function addServer(fields: Partial<McpServer> = {}): McpServer {
  const s: McpServer = { id: uid(), name: 'New server', transport: 'stdio', command: '', args: [], env: {}, url: '', headers: {}, enabled: true, allowed: [], createdAt: Date.now(), ...fields };
  saveServers([...servers, s]);
  return s;
}
export const updateServer = (id: string, patch: Partial<McpServer> | ((s: McpServer) => Partial<McpServer>)) =>
  saveServers(servers.map((s) => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)));
export async function removeServer(id: string) {
  await disconnectServer(id);
  saveServers(servers.filter((s) => s.id !== id));
  const { [id]: _gone, ...rest } = runtime;
  runtime = rest;
  emit();
}

/** Brings servers in from a backup; the caller reloads afterwards. */
export const writeServers = (list: McpServer[]) => localStorage.setItem(MCP_KEY, JSON.stringify(list));

// ---- connecting ------------------------------------------------------------------------------------

const readable = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export async function connectServer(id: string) {
  const s = servers.find((x) => x.id === id);
  if (!s || !host()) return;
  setRuntime(id, { status: 'connecting', tools: [] });
  try {
    const r = await host()!.mcp.connect({ id: s.id, transport: s.transport, command: s.command, args: s.args, env: s.env, url: s.url, headers: s.headers });
    setRuntime(id, { status: 'on', tools: r.tools, info: r.info });
  } catch (e) {
    setRuntime(id, { status: 'error', tools: [], error: readable(e) });
  }
}

export async function disconnectServer(id: string) {
  if (runtime[id] && runtime[id].status !== 'off') await host()?.mcp.disconnect(id).catch(() => {});
  setRuntime(id, { status: 'off', tools: [] });
}

/** At startup: pick up servers still connected (after a reload), and connect the ones set to start with Penumbra. */
export function startMcp() {
  const h = host();
  if (!h) return () => {};
  const off = h.mcp.onClosed((id, reason) => {
    if (servers.some((s) => s.id === id)) setRuntime(id, { status: 'error', tools: [], error: reason });
  });
  h.mcp.state().then((live) => {
    for (const [id, r] of Object.entries(live)) if (servers.some((s) => s.id === id)) setRuntime(id, { status: 'on', tools: r.tools, info: r.info });
    for (const s of servers) if (s.enabled && !live[s.id]) connectServer(s.id);
  }).catch(() => {});
  return off;
}

// ---- command lines ---------------------------------------------------------------------------------

/** Splits `npx -y "@scope/pkg" "/my folder"` into words, honoring quotes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let has = false;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** The inverse, for showing a command in a text field. */
export const joinCommand = (words: string[]) => words.map((w) => (/[\s"']/.test(w) || !w ? `"${w.replace(/"/g, '')}"` : w)).join(' ');

/** KEY=value lines to an object, and back. */
export function parsePairs(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(sep);
    if (i > 0 && line.slice(0, i).trim()) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
export const pairsText = (o: Record<string, string>, sep: '=' | ':') => Object.entries(o).map(([k, v]) => `${k}${sep === ':' ? ': ' : '='}${v}`).join('\n');

/** A returned picture, at most 768 px and re-saved as a JPEG, so it fits the model and the saved chat. Null if it can't be read. */
async function shrink(data: string, mime: string): Promise<string | null> {
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = `data:${mime};base64,${data}`;
    });
    const scale = Math.min(1, 768 / Math.max(img.width, img.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff'; // transparent pictures get a white background
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82).split(',')[1] || null;
  } catch {
    return null;
  }
}

// ---- the tools the model sees ----------------------------------------------------------------------

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** A call's arguments, short enough for a line of the timeline or an approval bar. */
const brief = (v: unknown, n: number) => {
  const text = JSON.stringify(v ?? {});
  return text.length > n ? `${text.slice(0, n)}…` : text;
};

/** Tools of every connected server, named mcp_<server>_<tool> (names are limited to 64 letters, digits, _ and -). */
export function mcpTools(): Tool[] {
  const h = host();
  if (!h) return [];
  const used = new Set<string>();
  const tools: Tool[] = [];
  for (const s of servers) {
    const rt = runtime[s.id];
    if (!rt || rt.status !== 'on') continue;
    for (const t of rt.tools) {
      const base = `mcp_${slug(s.name).slice(0, 14) || 'server'}_${t.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 60);
      let name = base;
      for (let n = 2; used.has(name); n++) name = `${base.slice(0, 56)}_${n}`;
      used.add(name);
      tools.push({
        name,
        label: `${s.name}: ${t.title || t.name}`,
        description: `${t.description || t.name} (from the connected app “${s.name}”)`.slice(0, 1500),
        parameters: t.inputSchema,
        summary: (a) => brief(a, 80),
        run: async (args, ctx) => {
          const current = servers.find((x) => x.id === s.id);
          if (!current?.allowed.includes(t.name)) {
            const answer = await ctx.approve({
              tool: `mcp:${s.id}:${t.name}`,
              title: `${s.name} wants to run “${t.title || t.name}”`,
              detail: brief(args, 1200),
              note: t.description ? t.description.slice(0, 240) : undefined,
              always: `Always allow “${t.name}” from ${s.name}`,
              confirm: 'Allow',
            });
            if (!answer) throw new Declined(`The user did not allow ${t.name} from ${s.name}. Do not call it again; continue another way or ask the user.`);
            if (answer === 'always') updateServer(s.id, (x) => ({ allowed: [...new Set([...x.allowed, t.name])] }));
          }
          // Stopping the reply stops the call too.
          const callId = uid();
          const stop = () => void h.mcp.cancel(s.id, callId).catch(() => {});
          ctx.signal.addEventListener('abort', stop, { once: true });
          try {
            const r = await h.mcp.call(s.id, t.name, args, current?.timeoutSec ?? servers.find((x) => x.id === s.id)?.timeoutSec ?? DEFAULT_TIMEOUT, callId);
            const images = (await Promise.all(r.images.map((i) => shrink(i.data, i.mimeType)))).filter((x): x is string => !!x);
            const text = r.isError ? `The tool reported an error: ${r.text || '(no details)'}` : r.text || (images.length ? '' : '(the tool returned nothing)');
            return images.length ? { text, images } : text;
          } catch (e) {
            if (ctx.signal.aborted) throw e;
            return `Couldn't call ${t.name}: ${readable(e)}`;
          } finally {
            ctx.signal.removeEventListener('abort', stop);
          }
        },
      });
    }
  }
  return tools;
}

/** True when some connected server has tools. */
export const hasMcpTools = () => servers.some((s) => runtime[s.id]?.status === 'on' && runtime[s.id].tools.length > 0);

// ---- examples to start from ------------------------------------------------------------------------

export const MCP_EXAMPLES: { id: string; name: string; description: string; command: string; needs?: string }[] = [
  { id: 'filesystem', name: 'Files', description: 'Read and write files in a folder you choose', command: 'npx -y @modelcontextprotocol/server-filesystem', needs: 'folder' },
  { id: 'memory', name: 'Memory', description: 'Remember facts between chats in a small knowledge graph', command: 'npx -y @modelcontextprotocol/server-memory' },
  { id: 'fetch', name: 'Fetch', description: 'Download web pages as text (needs uv installed)', command: 'uvx mcp-server-fetch' },
];
