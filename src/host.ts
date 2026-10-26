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
  setWidgetNetwork: (policy: { mode: NetMode; hosts: string[]; block: string[] }) => void;
  onWidgetRequest: (cb: (r: WidgetRequest) => void) => () => void;
}

declare global {
  interface Window {
    penumbraHost?: PenumbraHost;
  }
}

export const host = () => window.penumbraHost;
