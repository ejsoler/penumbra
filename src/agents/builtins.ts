// Built-in agent tools: web search and pages, the chat's folder (read and write), and the terminal.
// The main process enforces hard limits (electron/tools.cjs); here we ask the user first where the
// action is risky: any site outside the approved list (unless "Whole internet" is on) and every command.
import { host } from '../host';
import { alwaysAllow, APPROVED_HOSTS, getNetSettings, hostMatches } from '../widgets/network';
import { uid } from '../store';
import { Declined, type Tool, type ToolArgs, type ToolContext } from './tools';

/** Tool groups an agent or chat can be given. */
export type ToolGroup = 'skills' | 'web' | 'files' | 'write' | 'terminal';

export const TOOL_GROUPS: { id: ToolGroup; label: string; description: string; needsFolder?: boolean; risky?: boolean }[] = [
  { id: 'skills', label: 'Skills', description: 'Load skills when a task matches them' },
  { id: 'web', label: 'Web', description: 'Search the web and read pages. Sites outside the approved list ask you first' },
  { id: 'files', label: 'Read files', description: "List and read files in the chat's folder", needsFolder: true },
  { id: 'write', label: 'Write files', description: "Create and change files in the chat's folder. Replaced files go to the Trash", needsFolder: true },
  { id: 'terminal', label: 'Terminal', description: "Run commands in the chat's folder. Each command asks you first", needsFolder: true, risky: true },
];

export interface ToolEnv {
  /** The chat's folder, if one was chosen. */
  folder?: string;
}

const NO_FOLDER = "No folder is set for this chat. Tell the user to choose one with the folder button in the chat's settings panel, then try again.";
const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** In "approved sites" mode, a site outside the list needs the user's OK (once, or always). */
async function allowSite(url: string, ctx: ToolContext): Promise<string | null> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return `"${url}" is not a valid web address.`;
  }
  const s = getNetSettings();
  if (s.mode === 'all' || [...APPROVED_HOSTS, ...s.alwaysAllow].some((p) => hostMatches(hostname, p))) return null;
  const answer = await ctx.approve({
    tool: 'web_fetch',
    title: 'Open a website?',
    detail: url.length > 300 ? `${url.slice(0, 300)}…` : url,
    note: `${hostname} is not on the approved list. Check that the address doesn't contain anything private from your chat.`,
    always: `Always allow ${hostname}`,
    confirm: 'Allow once',
  });
  if (answer === 'always') alwaysAllow([hostname]);
  if (!answer) throw new Declined(`The user did not allow opening ${hostname}. Do not try it again; work with what you have or ask the user.`);
  return null;
}

function webTools(): Tool[] {
  return [
    {
      name: 'web_search',
      label: 'Search the web',
      description: 'Search the web. Returns titles, addresses, and short snippets. Use web_fetch to read a result.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for' } }, required: ['query'] },
      summary: (a) => str(a.query),
      run: async (a) => {
        const results = await host()!.tools.search(str(a.query));
        if (!results.length) return 'No results.';
        return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n');
      },
    },
    {
      name: 'web_fetch',
      label: 'Read web page',
      description: 'Download a web page or file and return its text. Only GET requests; never put private information from the chat into the address.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full https address' } }, required: ['url'] },
      summary: (a) => str(a.url),
      run: async (a, ctx) => {
        const url = str(a.url).trim();
        const denied = await allowSite(url, ctx);
        if (denied) return denied;
        const page = await host()!.tools.fetch(url);
        return `${page.title ? `# ${page.title}\n` : ''}${page.url} (HTTP ${page.status}, ${page.type || 'unknown type'})\n\n${page.text}`;
      },
    },
  ];
}

function fileTools(env: ToolEnv, write: boolean): Tool[] {
  const needFolder = (fn: (folder: string, a: ToolArgs, ctx: ToolContext) => Promise<string>) => async (a: ToolArgs, ctx: ToolContext) =>
    env.folder ? fn(env.folder, a, ctx).catch((e) => `Error: ${errText(e)}`) : NO_FOLDER;
  const tools: Tool[] = [
    {
      name: 'list_files',
      label: 'List files',
      description: "List files and folders in the chat's folder. Paths are relative to that folder.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Folder to list, relative to the chat folder (default ".")' },
          depth: { type: 'number', description: 'How many levels deep (1-5, default 2)' },
        },
      },
      summary: (a) => str(a.path) || '.',
      run: needFolder((f, a) => host()!.tools.list(f, str(a.path) || '.', Number(a.depth) || 2)),
    },
    {
      name: 'read_file',
      label: 'Read file',
      description: "Read a text file in the chat's folder. Long files come in parts; pass offset to continue.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, relative to the chat folder' },
          offset: { type: 'number', description: 'Byte offset to start from (default 0)' },
        },
        required: ['path'],
      },
      summary: (a) => str(a.path),
      run: needFolder((f, a) => host()!.tools.read(f, str(a.path), Number(a.offset) || 0)),
    },
  ];
  if (write) {
    tools.push({
      name: 'write_file',
      label: 'Write file',
      description: "Create or replace a text file in the chat's folder with the full content given. Folders are created as needed. To change a file, read it first and write back the whole new version.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, relative to the chat folder' },
          content: { type: 'string', description: 'The complete file content' },
        },
        required: ['path', 'content'],
      },
      summary: (a) => str(a.path),
      run: needFolder(async (f, a) => {
        const r = await host()!.tools.write(f, str(a.path), str(a.content));
        return `${r.replaced ? 'Replaced' : 'Created'} ${r.path} (${r.bytes} bytes).${r.replaced ? ' The previous version was moved to the Trash.' : ''}`;
      }),
    });
  }
  return tools;
}

function terminalTools(env: ToolEnv): Tool[] {
  return [
    {
      name: 'run_command',
      label: 'Run command',
      description:
        "Run a shell command in the chat's folder and return its output. The user must approve every command, so explain briefly why you need it first. Avoid commands that delete or change things outside the folder.",
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line to run' },
          timeout_seconds: { type: 'number', description: 'Stop after this many seconds (default 120, max 600)' },
        },
        required: ['command'],
      },
      summary: (a) => str(a.command),
      run: async (a, ctx) => {
        if (!env.folder) return NO_FOLDER;
        const command = str(a.command).trim();
        if (!command) return 'Error: empty command.';
        const ok = await ctx.approve({
          tool: 'run_command',
          title: 'Run this command?',
          detail: command,
          note: `In ${env.folder}`,
          confirm: 'Run',
        });
        if (!ok) throw new Declined('The user declined to run this command. Do not run it again; continue another way or ask the user.');
        const id = uid();
        const stop = () => host()!.tools.kill(id);
        ctx.signal.addEventListener('abort', stop, { once: true });
        try {
          const r = await host()!.tools.run(env.folder, command, id, Number(a.timeout_seconds) || 120);
          return `Exit code: ${r.code ?? r.signal ?? 'unknown'}\n${r.output || '(no output)'}`;
        } finally {
          ctx.signal.removeEventListener('abort', stop);
        }
      },
    },
  ];
}

/** The built-in tools for these groups (skills are added separately, see skills.ts). */
export function builtinTools(groups: ToolGroup[], env: ToolEnv): Tool[] {
  if (!host()) return [];
  const tools: Tool[] = [];
  if (groups.includes('web')) tools.push(...webTools());
  if (groups.includes('files') || groups.includes('write')) tools.push(...fileTools(env, groups.includes('write')));
  if (groups.includes('terminal')) tools.push(...terminalTools(env));
  return tools;
}

/** What the model is told about its tools' environment. */
export function toolsPrompt(groups: ToolGroup[], env: ToolEnv): string {
  const lines: string[] = [];
  if (groups.includes('web')) lines.push('- You can search the web (web_search) and read pages (web_fetch). Use them for current or specific facts, and say which pages you used.');
  if (groups.some((g) => g === 'files' || g === 'write' || g === 'terminal')) {
    lines.push(env.folder ? `- You work in the folder ${env.folder}. File paths are relative to it.` : "- No folder is set for this chat yet, so file and terminal tools won't work until the user picks one.");
  }
  if (groups.includes('write')) lines.push('- write_file replaces the whole file. Read a file before changing it.');
  if (groups.includes('terminal')) lines.push('- Every run_command needs the user\'s approval. Run one command at a time.');
  return lines.length ? `# Tools\n${lines.join('\n')}` : '';
}
