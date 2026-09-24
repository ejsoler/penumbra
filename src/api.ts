// Thin client for the Ollama REST API (https://github.com/ollama/ollama/blob/main/docs/api.md)

export const DEFAULT_HOST = 'http://127.0.0.1:11434';
const HOST_KEY = 'ollama-gui.host';

export interface ModelDetails {
  format?: string;
  family?: string;
  families?: string[] | null;
  parameter_size?: string;
  quantization_level?: string;
}

export interface LocalModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at: string;
  details: ModelDetails;
  remote_host?: string;
}

export interface RunningModel {
  name: string;
  model: string;
  size: number;
  size_vram: number;
  expires_at: string;
  context_length?: number;
  details: ModelDetails;
}

export interface ShowResponse {
  modelfile?: string;
  parameters?: string;
  template?: string;
  system?: string;
  license?: string;
  capabilities?: string[];
  details?: ModelDetails;
  model_info?: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface ChatChunk {
  message?: { role: string; content: string; thinking?: string };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface PullChunk {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  options?: Record<string, number>;
  think?: boolean;
  keep_alive?: string;
}

export function getHost(): string {
  try {
    return localStorage.getItem(HOST_KEY) || DEFAULT_HOST;
  } catch {
    return DEFAULT_HOST;
  }
}

export function setHost(host: string) {
  try {
    localStorage.setItem(HOST_KEY, host.replace(/\/+$/, ''));
  } catch {
    /* storage unavailable */
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(getHost() + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res;
}

async function* readNdjson<T>(res: Response): AsyncGenerator<T> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const parse = (line: string) => {
    const obj = JSON.parse(line);
    if (obj.error) throw new Error(obj.error);
    return obj as T;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield parse(line);
    }
  }
  if (buf.trim()) yield parse(buf.trim());
}

export async function version(): Promise<string> {
  const res = await request('/api/version');
  return (await res.json()).version;
}

export async function listModels(): Promise<LocalModel[]> {
  const res = await request('/api/tags');
  return (await res.json()).models ?? [];
}

export async function listRunning(): Promise<RunningModel[]> {
  const res = await request('/api/ps');
  return (await res.json()).models ?? [];
}

export async function showModel(model: string): Promise<ShowResponse> {
  const res = await request('/api/show', { method: 'POST', body: JSON.stringify({ model }) });
  return res.json();
}

export async function deleteModel(model: string): Promise<void> {
  await request('/api/delete', { method: 'DELETE', body: JSON.stringify({ model }) });
}

/** Load a model into memory without generating anything. */
export async function loadModel(model: string, keepAlive = '30m', options?: Record<string, number>): Promise<void> {
  await request('/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: keepAlive, options }) });
}

export async function unloadModel(model: string): Promise<void> {
  await request('/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) });
}

export async function* chat(body: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
  const res = await request('/api/chat', { method: 'POST', body: JSON.stringify({ ...body, stream: true }), signal });
  yield* readNdjson<ChatChunk>(res);
}

export async function* pull(model: string, signal?: AbortSignal): AsyncGenerator<PullChunk> {
  const res = await request('/api/pull', { method: 'POST', body: JSON.stringify({ model, stream: true }), signal });
  yield* readNdjson<PullChunk>(res);
}

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}
