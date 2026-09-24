// Hugging Face Hub helpers for finding GGUF models that Ollama can pull via `hf.co/<repo>:<quant>`.

const HUB = 'https://huggingface.co';

export interface HfModel {
  id: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag?: string;
  lastModified?: string;
  createdAt?: string;
}

export interface HfQuant {
  quant: string;
  size: number;
  files: string[];
  split: boolean;
}

export type HfSort = 'trendingScore' | 'downloads' | 'likes' | 'lastModified';

interface TreeEntry {
  type: 'file' | 'directory';
  path: string;
  size: number;
  lfs?: { size: number };
}

export async function searchModels(query: string, sort: HfSort = 'trendingScore', limit = 40): Promise<HfModel[]> {
  const params = new URLSearchParams({ filter: 'gguf', sort, direction: '-1', limit: String(limit) });
  if (query.trim()) params.set('search', query.trim());
  const res = await fetch(`${HUB}/api/models?${params}`);
  if (!res.ok) throw new Error(`Hugging Face search failed (${res.status})`);
  return res.json();
}

const QUANT_RE = /(?:^|[-_.])((?:UD-)?(?:IQ\d_[A-Z]+|I?Q\d_K(?:_[A-Z]+)?|Q\d_\d|TQ\d_\d|MXFP4(?:_MOE)?|BF16|F16|F32))(?=[-_.]|$)/i;
const SPLIT_RE = /-\d{5}-of-\d{5}\.gguf$/i;

/** Lists a repo's GGUF files grouped by quantization, smallest first. */
export async function listQuants(repo: string): Promise<HfQuant[]> {
  const res = await fetch(`${HUB}/api/models/${repo}/tree/main?recursive=true`);
  if (res.status === 401 || res.status === 403) throw new Error('This repo is gated or private — accept its license on huggingface.co first.');
  if (!res.ok) throw new Error(`Could not list files (${res.status})`);
  const entries: TreeEntry[] = await res.json();

  const groups = new Map<string, HfQuant>();
  for (const e of entries) {
    if (e.type !== 'file' || !e.path.toLowerCase().endsWith('.gguf')) continue;
    const base = e.path.split('/').pop()!;
    if (/mmproj/i.test(base)) continue; // vision projectors are fetched automatically by Ollama
    const quant = (QUANT_RE.exec(base.replace(/\.gguf$/i, ''))?.[1] ?? base.replace(/\.gguf$/i, '')).toUpperCase();
    const g = groups.get(quant) ?? { quant, size: 0, files: [], split: false };
    g.size += e.lfs?.size ?? e.size;
    g.files.push(e.path);
    g.split ||= SPLIT_RE.test(base);
    groups.set(quant, g);
  }
  return [...groups.values()].sort((a, b) => a.size - b.size);
}

/** The name Ollama uses to pull (and later list) a Hugging Face model. */
export const ollamaName = (repo: string, quant: string) => `hf.co/${repo}:${quant}`;

/** Accepts "user/repo", "hf.co/user/repo" or a full huggingface.co URL. */
export function parseRepo(input: string): string | null {
  const m = /^(?:https?:\/\/)?(?:(?:www\.)?huggingface\.co\/|hf\.co\/)?([\w.-]+\/[\w.-]+)(?:[/:?#].*)?$/.exec(input.trim());
  return m ? m[1] : null;
}

/** Quants that are a good default balance of size and quality. */
export const RECOMMENDED = ['Q4_K_M', 'UD-Q4_K_XL', 'Q4_K_S', 'Q5_K_M'];

export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
