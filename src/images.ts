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
function start() {
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
export async function generateImage(req: { id: string; prompt: string; width?: number; height?: number; steps?: number; seed?: number }) {
  const h = host();
  if (!h) throw new Error('Image generation needs the desktop app');
  set({ generating: { phase: 'loading', step: 0, steps: req.steps ?? 0 } });
  try {
    return await h.images.generate(req);
  } finally {
    set({ generating: null });
  }
}

/** Ready-to-use image models, for menus. */
export const readyModels = (s: ImagesStatus | null) => (s?.models ?? []).filter((m) => m.ready);

export const modelLabel = (m: { repo: string; file: string }) => `${m.repo.split('/')[1]} · ${m.file.split('/').pop()!.replace(/\.gguf$/i, '')}`;
