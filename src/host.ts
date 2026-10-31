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

export interface ImageModel {
  id: string;
  repo: string;
  file: string;
  family: string;
  familyLabel: string;
  size: number;
  nsfw: boolean;
  addedAt: number;
  /** Its family's shared files are all downloaded. */
  ready: boolean;
  missing: string[];
}

export interface ImagesStatus {
  /** stable-diffusion.cpp has a build for this computer. */
  supported: boolean;
  engine: { version: string } | null;
  models: ImageModel[];
  families: Record<string, string>;
  folder: string;
}

export interface SaveDir {
  dir: string;
  isDefault: boolean;
}

export interface GeneratedImage {
  image: string;
  file: string;
  prompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  at?: number;
}

export interface ImageProgress {
  id: string;
  phase: 'engine' | 'downloading' | 'done' | 'error' | 'cancelled';
  file?: string;
  got?: number;
  total?: number;
  error?: string;
}

export interface ProfileInfo {
  id: string;
  name: string;
  avatar?: string;
  hasPassword: boolean;
  /** This window's profile. */
  current: boolean;
  /** The profile Penumbra opens at startup. */
  isDefault: boolean;
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
  images: {
    status: () => Promise<ImagesStatus>;
    /** Reads a Hugging Face GGUF file's architecture without downloading it. */
    inspect: (repo: string, file: string) => Promise<{ arch: string | null; family: string | null; familyLabel?: string | null; reason: string | null }>;
    /** Downloads the model (plus the engine and shared files it needs); resolves to the job id. */
    download: (req: { repo: string; file: string; nsfw?: boolean }) => Promise<string>;
    cancel: (id: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    /** `folder`: a chat's folder to save in, instead of the chosen save folder. */
    generate: (req: { id: string; prompt: string; width?: number; height?: number; steps?: number; seed?: number; folder?: string }) => Promise<GeneratedImage>;
    stop: () => Promise<void>;
    gallery: (limit?: number) => Promise<GeneratedImage[]>;
    deleteOutput: (file: string) => Promise<void>;
    /** Shows an image in its folder; with no file, opens the save folder. */
    reveal: (file?: string) => Promise<void>;
    /** Opens the folder with models, the engine, and shared files. */
    openModels: () => Promise<void>;
    saveDir: () => Promise<SaveDir>;
    /** Asks the user for a folder; returns the (possibly unchanged) setting. */
    chooseSaveDir: () => Promise<SaveDir>;
    resetSaveDir: () => Promise<SaveDir>;
    onProgress: (cb: (p: ImageProgress) => void) => () => void;
    onGenerate: (cb: (p: { phase: 'loading' | 'sampling' | 'decoding'; step: number; steps: number }) => void) => () => void;
  };
  /** Profiles: separate data, optionally behind a password (an app lock, not disk encryption). */
  profiles: {
    current: () => Promise<ProfileInfo & { locked: boolean }>;
    list: () => Promise<ProfileInfo[]>;
    /** True if the password was right; this window's profile is then unlocked. */
    unlock: (password: string) => Promise<boolean>;
    update: (patch: { name?: string; avatar?: string | null }) => Promise<void>;
    create: (req: { name: string; password?: string }) => Promise<string>;
    /** Reopens the window on another profile. */
    switchTo: (id: string) => Promise<void>;
    /** Reopens the window on this profile, locked. */
    lock: () => Promise<void>;
    /** `next` empty removes the password; `current` is needed when one is set. */
    setPassword: (req: { current?: string; next: string }) => Promise<{ hasPassword: boolean }>;
    remove: (req: { id: string; password?: string }) => Promise<void>;
    /** Makes a profile the one Penumbra opens at startup. */
    setDefault: (id: string) => Promise<void>;
    /** Copies a chat (and agents it uses) into another profile; resolves to its id there. */
    moveChat: (req: { target: string; password?: string; conversation: unknown; agents: unknown[] }) => Promise<string>;
  };
  /** Opens the guided demo in its own window (separate chats, agents, and skills). */
  startDemo: (model: string) => Promise<'started' | 'focused'>;
  setTrayStatus: (status: { enabled: boolean; active: number; next: { name: string; when: string } | null }) => void;
  showWindow: () => void;
  setWidgetNetwork: (policy: { mode: NetMode; hosts: string[]; block: string[] }) => void;
  onWidgetRequest: (cb: (r: WidgetRequest) => void) => () => void;
}

declare global {
  interface Window {
    penumbraHost?: PenumbraHost;
  }
}

export const host = () => window.penumbraHost;
