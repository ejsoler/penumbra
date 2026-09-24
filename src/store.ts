import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  images?: string[];
  model?: string;
  error?: string;
  stopped?: boolean;
  stats?: { tokens: number; tps: number; ttft: number; promptTokens: number; seconds: number };
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  systemPrompt: string;
  messages: UiMessage[];
  updatedAt: number;
}

export interface GenParams {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  repeat_penalty: number;
  num_ctx: number;
  num_predict: number;
  seed: number;
  think: boolean;
  keep_alive: string;
}

export const DEFAULT_PARAMS: GenParams = {
  temperature: 0.8,
  top_p: 0.9,
  top_k: 40,
  min_p: 0.05,
  repeat_penalty: 1.1,
  num_ctx: 8192,
  num_predict: -1,
  seed: -1,
  think: true,
  keep_alive: '30m',
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** useState backed by localStorage, with a debounced write so streaming doesn't thrash storage. */
export function usePersistent<T>(key: string, initial: T, delay = 400) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn(`Could not persist ${key}`, e);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [key, value, delay]);
  return [value, setValue] as const;
}

export interface OllamaState {
  connected: boolean | null;
  version: string;
  models: api.LocalModel[];
  running: api.RunningModel[];
  capabilities: Record<string, string[]>;
  refresh: () => Promise<void>;
}

/** Polls Ollama for installed + loaded models and caches each model's capabilities. */
export function useOllama(): OllamaState {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [ver, setVer] = useState('');
  const [models, setModels] = useState<api.LocalModel[]>([]);
  const [running, setRunning] = useState<api.RunningModel[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, string[]>>({});
  const capsRef = useRef(capabilities);
  capsRef.current = capabilities;

  const refresh = useCallback(async () => {
    try {
      const [m, r, v] = await Promise.all([api.listModels(), api.listRunning(), api.version()]);
      setModels(m.sort((a, b) => a.name.localeCompare(b.name)));
      setRunning(r);
      setVer(v);
      setConnected(true);
      const missing = m.filter((x) => !capsRef.current[x.name]);
      if (missing.length) {
        const entries = await Promise.all(
          missing.map(async (x) => {
            try {
              return [x.name, (await api.showModel(x.name)).capabilities ?? []] as const;
            } catch {
              return [x.name, []] as const;
            }
          }),
        );
        setCapabilities((c) => ({ ...c, ...Object.fromEntries(entries) }));
      }
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  return { connected, version: ver, models, running, capabilities, refresh };
}
