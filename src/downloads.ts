import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';

// Ollama keeps partially downloaded layers on disk, so pulling a model again continues where it
// stopped. Pause = abort the request; Resume = pull again.

export type DownloadState = 'downloading' | 'paused' | 'error' | 'done';

export interface Download {
  name: string;
  state: DownloadState;
  status: string;
  completed: number;
  total: number;
  bytesPerSec: number;
  error?: string;
}

const STORE_KEY = 'ollama-gui.downloads';

/** Unfinished downloads from a previous session come back paused. */
function restore(): Record<string, Download> {
  try {
    const saved: Download[] = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Object.fromEntries(
      saved.map((d) => [d.name, { ...d, state: 'paused' as const, status: 'Paused', bytesPerSec: 0 }]),
    );
  } catch {
    return {};
  }
}

export function useDownloads(onFinished: () => void) {
  const [downloads, setDownloads] = useState<Record<string, Download>>(restore);
  const controllers = useRef<Record<string, AbortController>>({});
  const pausing = useRef(new Set<string>());

  useEffect(() => {
    const t = setTimeout(() => {
      const unfinished = Object.values(downloads).filter((d) => d.state !== 'done');
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(unfinished));
      } catch {
        /* storage unavailable */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [downloads]);

  const patch = (name: string, p: Partial<Download>) =>
    setDownloads((d) => (d[name] ? { ...d, [name]: { ...d[name], ...p } } : d));

  const start = useCallback(
    async (name: string) => {
      if (controllers.current[name]) return; // already running
      const controller = new AbortController();
      controllers.current[name] = controller;
      pausing.current.delete(name);
      setDownloads((d) => ({
        ...d,
        // Keep previous progress visible while a resume reconnects.
        [name]: { completed: 0, total: 0, ...(d[name] as Partial<Download> | undefined), name, state: 'downloading', status: 'Connecting…', bytesPerSec: 0, error: undefined },
      }));

      const layers: Record<string, { completed: number; total: number }> = {};
      let sample = { t: performance.now(), bytes: -1 };
      let speed = 0;
      try {
        for await (const chunk of api.pull(name, controller.signal)) {
          if (chunk.digest && chunk.total) layers[chunk.digest] = { completed: chunk.completed ?? 0, total: chunk.total };
          const all = Object.values(layers);
          const completed = all.reduce((n, l) => n + l.completed, 0);
          const total = all.reduce((n, l) => n + l.total, 0);

          // Smoothed speed, sampled at most twice a second.
          const now = performance.now();
          if (sample.bytes < 0) sample = { t: now, bytes: completed };
          else if (now - sample.t > 500) {
            const instant = ((completed - sample.bytes) / (now - sample.t)) * 1000;
            speed = speed ? speed * 0.7 + instant * 0.3 : instant;
            sample = { t: now, bytes: completed };
          }
          patch(name, { status: chunk.status, bytesPerSec: speed, ...(total ? { completed, total } : {}) });
        }
        patch(name, { state: 'done', status: 'Downloaded', completed: 1, total: 1, bytesPerSec: 0 });
        onFinished();
      } catch (e) {
        if (pausing.current.has(name)) patch(name, { state: 'paused', status: 'Paused', bytesPerSec: 0 });
        else if (!controller.signal.aborted) patch(name, { state: 'error', status: 'Failed', error: (e as Error).message, bytesPerSec: 0 });
      } finally {
        delete controllers.current[name];
        pausing.current.delete(name);
      }
    },
    [onFinished],
  );

  const pause = (name: string) => {
    pausing.current.add(name);
    controllers.current[name]?.abort();
  };

  /** Stops (if running) and removes from the list. Partial data stays until Ollama prunes it. */
  const remove = (name: string) => {
    controllers.current[name]?.abort();
    setDownloads((d) => {
      const { [name]: _, ...rest } = d;
      return rest;
    });
  };

  return { downloads, start, resume: start, pause, remove };
}

export type Downloads = ReturnType<typeof useDownloads>;

export function formatEta(d: Download): string {
  if (d.state !== 'downloading' || d.bytesPerSec < 1 || !d.total) return '';
  const s = (d.total - d.completed) / d.bytesPerSec;
  if (s < 60) return `${Math.ceil(s)}s left`;
  if (s < 3600) return `${Math.round(s / 60)}m left`;
  return `${(s / 3600).toFixed(1)}h left`;
}
