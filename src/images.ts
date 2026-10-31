// Local image generation state: installed image models, downloads in progress, and the image being made.
// The work happens in the main process (electron/images.cjs); this keeps the app's view of it.
import { useSyncExternalStore } from 'react';
import { host, type ImageProgress, type ImagesStatus } from './host';

export interface GenProgress {
  phase: 'loading' | 'sampling' | 'decoding';
  step: number;
  steps: number;
}

interface State {
  status: ImagesStatus | null;
  downloads: Record<string, ImageProgress>;
  generating: GenProgress | null;
}

let state: State = { status: null, downloads: {}, generating: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const useImages = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    start();
    return () => listeners.delete(l);
  }, () => state);

export const cleanError = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export async function refreshImages() {
  const h = host();
  if (h) set({ status: await h.images.status().catch(() => null) });
}

let started = false;
/** Starts listening for downloads and image progress (once); also called at app start. */
export function start() {
  const h = host();
  if (started || !h) return;
  started = true;
  refreshImages();
  h.images.onProgress((p) => {
    set({ downloads: { ...state.downloads, [p.id]: p } });
    if (p.phase === 'done') refreshImages();
  });
  h.images.onGenerate((p) => set({ generating: p }));
}

export const dismissDownload = (id: string) => {
  const { [id]: _, ...rest } = state.downloads;
  set({ downloads: rest });
};

/** Generates an image; resolves to its data URL. */
export async function generateImage(req: { id: string; prompt: string; width?: number; height?: number; steps?: number; seed?: number; folder?: string }) {
  const h = host();
  if (!h) throw new Error('Image generation needs the desktop app');
  set({ generating: { phase: 'loading', step: 0, steps: req.steps ?? 0 } });
  try {
    return await h.images.generate(req);
  } finally {
    set({ generating: null });
  }
}

/** True when an image model is ready (as of the last status check). */
export const hasImageModel = () => readyModels(state.status).length > 0;

/** The image model tools use: the one picked in the Images tab, else the first ready one. */
export async function imageModelFor() {
  if (!state.status) await refreshImages();
  const ready = readyModels(state.status);
  let picked = '';
  try {
    picked = JSON.parse(localStorage.getItem('ollama-gui.imageModel') || '""');
  } catch {
    /* none picked */
  }
  return ready.find((m) => m.id === picked) ?? ready[0] ?? null;
}

/** Address of an image Penumbra made, wherever it was saved (the main process only serves those). */
export const imageUrl = (file: string) => `penumbra-image://img/${encodeURIComponent(file)}`;

/** Ready-to-use image models, for menus. */
export const readyModels = (s: ImagesStatus | null) => (s?.models ?? []).filter((m) => m.ready);

export const modelLabel = (m: { repo: string; file: string }) => `${m.repo.split('/')[1]} · ${m.file.split('/').pop()!.replace(/\.gguf$/i, '')}`;
