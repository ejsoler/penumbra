// The desktop app's bridge to the Electron main process (electron/preload.cjs). It is missing when
// Penumbra runs in a plain browser (npm run dev), so every caller has to handle `undefined`.
import type { NetMode, WidgetRequest } from './widgets/network';

export interface SkillInfo {
  /** Folder name under <userData>/skills. */
  id: string;
  name: string;
  description: string;
  /** Reference files besides SKILL.md, relative to the skill folder. */
  files: string[];
}

export interface UpdateInfo {
  current: string;
  available: boolean;
  version?: string;
  url?: string;
  notes?: string;
  publishedAt?: string | null;
  /** The installer for this computer, if the release has one. */
  file?: { name: string; size: number } | null;
}

export interface PenumbraHost {
  skills: {
    list: () => Promise<SkillInfo[]>;
    read: (id: string) => Promise<string>;
    readFile: (id: string, rel: string) => Promise<string>;
    /** Saves SKILL.md; with no id, creates a new skill folder named after it. Returns the id. */
    save: (id: string | null, content: string) => Promise<string>;
    /** Moves the skill folder to the Trash. */
    remove: (id: string) => Promise<void>;
    /** Asks the user for folders or .zip files and installs every skill in them. */
    import: () => Promise<string[]>;
    reveal: (id?: string) => Promise<string>;
  };
  tools: {
    /** Asks the user to pick a folder; null if they cancel. */
    pickFolder: () => Promise<string | null>;
    list: (root: string, rel?: string, depth?: number) => Promise<string>;
    read: (root: string, rel: string, offset?: number) => Promise<string>;
    write: (root: string, rel: string, content: string) => Promise<{ path: string; replaced: boolean; bytes: number }>;
    run: (root: string, command: string, id: string, timeoutSec?: number) => Promise<{ code: number | null; signal: string | null; output: string }>;
    kill: (id: string) => Promise<void>;
    fetch: (url: string) => Promise<{ url: string; status: number; type: string; title?: string; text: string }>;
    search: (query: string) => Promise<{ title: string; url: string; snippet: string }[]>;
    reveal: (root: string) => Promise<string>;
  };
  updates: {
    check: () => Promise<UpdateInfo>;
    /** Downloads the installer for this computer to Downloads; resolves to its path. */
    download: () => Promise<string>;
    cancel: () => Promise<void>;
    /** Opens the downloaded installer (on Windows, Penumbra then quits so it can be replaced). */
    install: (file: string) => Promise<'opened' | 'shown'>;
    reveal: () => Promise<void>;
    onProgress: (cb: (p: { got: number; total: number }) => void) => () => void;
  };
  setWidgetNetwork: (policy: { mode: NetMode; hosts: string[]; block: string[] }) => void;
  onWidgetRequest: (cb: (r: WidgetRequest) => void) => () => void;
}

declare global {
  interface Window {
    penumbraHost?: PenumbraHost;
  }
}

export const host = () => window.penumbraHost;
