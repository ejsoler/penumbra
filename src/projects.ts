// Projects: a named group of chats that share instructions, a local folder, and source files, like ChatGPT's
// project folders. Every chat in a project gets its instructions and sources in the system prompt and works
// in its folder (unless the chat has its own). Stored locally, per profile.
import { useSyncExternalStore } from 'react';
import { estimateTokens } from './context';
import type { Tool } from './agents/tools';
import { uid, type Conversation } from './store';

/** A text file or note kept in a project. */
export interface ProjectSource {
  id: string;
  name: string;
  text: string;
  addedAt: number;
}

export interface Project {
  id: string;
  name: string;
  /** Rules and background every chat in the project follows. */
  instructions: string;
  /** The folder file and terminal tools work in, for chats that don't have their own. */
  folder?: string;
  sources: ProjectSource[];
  /** Whether the project is closed in the chat list. */
  collapsed?: boolean;
  createdAt: number;
}

export const PROJECTS_KEY = 'ollama-gui.projects';
/** One source: keeps the browser's storage (about 5 MB for everything) from filling up. */
export const MAX_SOURCE = 300 * 1024;
export const MAX_PROJECT_SOURCES = 1_500_000;

let projects: Project[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

/** Saves the list. Returns false (and changes nothing) if the browser's storage is full. */
function save(next: Project[]) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  projects = next;
  listeners.forEach((l) => l());
  return true;
}

export const useProjects = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => projects,
  );

export const getProjects = () => projects;
export const getProject = (id?: string) => (id ? projects.find((p) => p.id === id) : undefined);

export function createProject(fields: Partial<Project> = {}): Project {
  const p: Project = { id: uid(), name: 'New project', instructions: '', sources: [], createdAt: Date.now(), ...fields };
  save([...projects, p]);
  return p;
}

export const updateProject = (id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>)) =>
  save(projects.map((p) => (p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)));

export const deleteProject = (id: string) => save(projects.filter((p) => p.id !== id));

/** Brings projects in from a backup or another profile; the caller reloads afterwards. */
export const writeProjects = (list: Project[]) => localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));

export const sourcesSize = (p: Project) => p.sources.reduce((n, s) => n + s.text.length, 0);

/** The folder a chat's file and terminal tools work in: its own, or its project's. */
export const chatFolder = (c: Pick<Conversation, 'folder' | 'projectId'>) => c.folder || getProject(c.projectId)?.folder;

// ---- what the model gets ---------------------------------------------------------------------------

/** Share of the context the project's sources may take. */
const SOURCE_SHARE = 0.3;

export interface ProjectContext {
  /** Goes in the system prompt. */
  prompt: string;
  /** Sources that didn't fit whole, which the model can read through the tool. */
  shortened: ProjectSource[];
}

/**
 * The project's instructions and sources as a system prompt part. Sources go in whole while they fit in
 * `numCtx`'s share; the rest are cut to an excerpt, and `project_source` reads the full text.
 */
export function projectContext(project: Project | undefined, numCtx: number, toolsSupported: boolean): ProjectContext {
  if (!project) return { prompt: '', shortened: [] };
  const lines = [`This chat is part of the project "${project.name}".`];
  if (project.instructions.trim()) lines.push('', 'Project instructions (follow them in every reply):', project.instructions.trim());
  const shortened: ProjectSource[] = [];
  if (project.sources.length) {
    let room = Math.floor(numCtx * SOURCE_SHARE);
    const sorted = [...project.sources].sort((a, b) => a.text.length - b.text.length);
    // Smallest first, so many short sources all fit; the large ones share what's left.
    const share = new Map<string, number>();
    sorted.forEach((s, i) => {
      const fair = Math.floor(room / (sorted.length - i));
      const used = Math.min(estimateTokens(s.text), fair);
      share.set(s.id, used);
      room -= used;
    });
    lines.push('', 'Project sources: files and notes the user keeps in this project. Use them when they help, and say which one you used.');
    for (const s of project.sources) {
      const tokens = share.get(s.id) ?? 0;
      const whole = estimateTokens(s.text) <= tokens;
      const text = whole ? s.text : s.text.slice(0, Math.max(0, Math.floor(tokens * 3.2)));
      if (!whole) shortened.push(s);
      lines.push('', `<source name="${s.name.replace(/"/g, "'")}"${whole ? '' : ' shortened="true"'}>`, text, '</source>');
    }
    if (shortened.length) {
      lines.push(
        '',
        toolsSupported
          ? `Sources marked shortened are cut off. Call the project_source tool with a source's name (and an offset to continue) to read the rest.`
          : 'Sources marked shortened are cut off; say so if the missing part matters.',
      );
    }
  }
  return { prompt: lines.join('\n'), shortened };
}

const CHUNK = 6000;

/** Reads the rest of a source that was cut off in the prompt. */
export function projectSourceTool(project: Project): Tool {
  return {
    name: 'project_source',
    label: 'Read project source',
    description: `Reads a file or note from the project "${project.name}". Use it for sources marked shortened. Returns up to ${CHUNK} characters starting at offset; call again with a larger offset to keep reading.`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: `One of: ${project.sources.map((s) => s.name).join(', ')}` },
        offset: { type: 'number', description: 'Character to start at (default 0)' },
      },
      required: ['name'],
    },
    summary: (a) => String(a.name ?? ''),
    run: async (a) => {
      const name = String(a.name ?? '').toLowerCase();
      const s = project.sources.find((x) => x.name.toLowerCase() === name);
      if (!s) return `No source named "${a.name}". Sources: ${project.sources.map((x) => x.name).join(', ')}.`;
      const at = Math.max(0, Number(a.offset) || 0);
      const part = s.text.slice(at, at + CHUNK);
      const end = at + part.length;
      return `${part}\n\n[${s.name}: characters ${at}–${end} of ${s.text.length}${end < s.text.length ? `; continue with offset ${end}` : '; end of the source'}]`;
    },
  };
}

/** Reads a text file the user picked as a source. Throws a readable message if it can't be used. */
export async function readSourceFile(f: File): Promise<ProjectSource> {
  if (f.size > MAX_SOURCE) throw new Error(`${f.name} is too large (max ${MAX_SOURCE / 1024} KB)`);
  const text = await f.text();
  if (text.slice(0, 8000).includes('\u0000')) throw new Error(`${f.name} isn't a text file`);
  return { id: uid(), name: f.name, text, addedAt: Date.now() };
}
