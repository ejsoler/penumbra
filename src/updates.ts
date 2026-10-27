// Checks GitHub for a newer Penumbra (see electron/updates.cjs) shortly after launch and twice a day.
// Nothing pops up: a newer version shows as a small icon in the sidebar, and the user decides
// whether to download it, skip that version, or turn the check off.
import { useSyncExternalStore } from 'react';
import { host, type UpdateInfo } from './host';

const SETTINGS_KEY = 'ollama-gui.updates';
const FIRST_CHECK_MS = 8000;
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;

export interface UpdateSettings {
  auto: boolean;
  /** A version the user chose to skip: no sidebar icon for it. */
  skipped: string;
}

export interface UpdateState {
  settings: UpdateSettings;
  info: UpdateInfo | null;
  checking: boolean;
  checkedAt: number | null;
  error: string;
  download: { phase: 'idle' | 'downloading' | 'done' | 'error'; got: number; total: number; file: string; error: string };
}

const loadSettings = (): UpdateSettings => {
  try {
    return { auto: true, skipped: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { auto: true, skipped: '' };
  }
};

let state: UpdateState = {
  settings: loadSettings(),
  info: null,
  checking: false,
  checkedAt: null,
  error: '',
  download: { phase: 'idle', got: 0, total: 0, file: '', error: '' },
};
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const setDownload = (patch: Partial<UpdateState['download']>) => set({ download: { ...state.download, ...patch } });

const cleanError = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const useUpdates = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => state);

/** True when the sidebar should show the update icon. */
export const updateWaiting = (s: UpdateState) => !!s.info?.available && s.info.version !== s.settings.skipped;

export function setUpdateSettings(patch: Partial<UpdateSettings>) {
  const settings = { ...state.settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
  set({ settings });
  if (patch.auto) checkForUpdates();
}

export async function checkForUpdates() {
  const h = host();
  if (!h || state.checking) return;
  set({ checking: true, error: '' });
  try {
    set({ info: await h.updates.check(), checkedAt: Date.now() });
  } catch (e) {
    set({ error: cleanError(e) });
  } finally {
    set({ checking: false });
  }
}

export async function downloadUpdate() {
  const h = host();
  if (!h || state.download.phase === 'downloading') return;
  setDownload({ phase: 'downloading', got: 0, total: state.info?.file?.size ?? 0, error: '' });
  try {
    const file = await h.updates.download();
    setDownload({ phase: 'done', file, got: state.download.total });
  } catch (e) {
    setDownload({ phase: 'error', error: cleanError(e) });
  }
}

export const cancelDownload = () => host()?.updates.cancel();
export const revealDownload = () => host()?.updates.reveal();

export async function installUpdate() {
  try {
    await host()?.updates.install(state.download.file);
  } catch (e) {
    setDownload({ phase: 'error', error: cleanError(e) });
  }
}

let started = false;
/** Starts the background check (once). */
export function startUpdateChecks() {
  const h = host();
  if (started || !h) return;
  started = true;
  h.updates.onProgress(({ got, total }) => setDownload({ got, total: total || state.download.total }));
  const tick = () => state.settings.auto && checkForUpdates();
  setTimeout(tick, FIRST_CHECK_MS);
  setInterval(tick, CHECK_EVERY_MS);
}
