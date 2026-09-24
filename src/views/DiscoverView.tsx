import { useState } from 'react';
import * as api from '../api';
import type { OllamaState } from '../store';
import { formatEta, type Download as DownloadJob, type Downloads } from '../downloads';
import { useContextMenu, copyText } from '../components/ContextMenu';
import { Check, Copy, Download, Loader2, Pause, Play, RotateCcw, Search, Telescope, X } from '../components/icons';
import { HuggingFaceView } from './HuggingFaceView';
import { usePersistent } from '../store';

interface Suggested {
  name: string;
  desc: string;
  tags: string[];
  sizes: string[];
}

// A curated starting list; any tag from ollama.com/library can be pulled by name.
const SUGGESTED: Suggested[] = [
  { name: 'llama3.2', desc: "Meta's compact Llama 3.2 models, great for everyday chat on modest hardware.", tags: ['tools'], sizes: ['1b', '3b'] },
  { name: 'llama3.1', desc: 'Meta Llama 3.1 — strong general-purpose model with 128K context.', tags: ['tools'], sizes: ['8b', '70b'] },
  { name: 'qwen3', desc: "Alibaba's Qwen3 family with hybrid thinking / non-thinking modes.", tags: ['tools', 'thinking'], sizes: ['0.6b', '4b', '8b', '14b', '32b'] },
  { name: 'gemma3', desc: "Google's Gemma 3, multimodal with image understanding.", tags: ['vision'], sizes: ['1b', '4b', '12b', '27b'] },
  { name: 'deepseek-r1', desc: 'DeepSeek-R1 reasoning models distilled to smaller sizes.', tags: ['thinking', 'tools'], sizes: ['1.5b', '7b', '8b', '14b', '32b'] },
  { name: 'gpt-oss', desc: "OpenAI's open-weight reasoning models.", tags: ['thinking', 'tools'], sizes: ['20b', '120b'] },
  { name: 'mistral', desc: 'Mistral 7B — fast and capable, a classic.', tags: ['tools'], sizes: ['7b'] },
  { name: 'phi4', desc: "Microsoft's Phi-4, a strong 14B model for reasoning and code.", tags: [], sizes: ['14b'] },
  { name: 'qwen2.5-coder', desc: 'Code-specialized Qwen 2.5 models.', tags: ['tools'], sizes: ['1.5b', '7b', '14b', '32b'] },
  { name: 'llava', desc: 'Vision-language model for describing and reasoning over images.', tags: ['vision'], sizes: ['7b', '13b'] },
  { name: 'nomic-embed-text', desc: 'High-quality text embedding model for RAG and search.', tags: ['embedding'], sizes: ['latest'] },
  { name: 'granite3.3', desc: "IBM's Granite 3.3 with long context and tool use.", tags: ['tools'], sizes: ['2b', '8b'] },
];

export function DiscoverView({ ollama, dl }: { ollama: OllamaState; dl: Downloads }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = usePersistent<'ollama' | 'hf'>('ollama-gui.discoverSource', 'ollama');
  const installed = new Set(ollama.models.map((m) => m.name));
  const isInstalled = (n: string) => installed.has(n) || installed.has(`${n}:latest`);
  const active = Object.values(dl.downloads);

  const filtered = SUGGESTED.filter(
    (s) => !query || s.name.includes(query.toLowerCase()) || s.desc.toLowerCase().includes(query.toLowerCase()),
  );

  const pullQuery = () => {
    const name = query.trim();
    if (name) dl.start(name); // no-op if already running; resumes if paused
  };

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Discover</h1>
          <p className="muted">
            Download models from the <a href="https://ollama.com/library" target="_blank" rel="noreferrer">Ollama library</a> or any GGUF
            repo on <a href="https://huggingface.co/models?library=gguf" target="_blank" rel="noreferrer">Hugging Face</a>.
          </p>
        </div>
      </header>

      {active.length > 0 && (
        <section className="downloads">
          <div className="downloads-head">
            <h4>Downloads</h4>
            {active.some((d) => d.state === 'done') && (
              <button className="btn sm ghost" onClick={() => active.filter((d) => d.state === 'done').forEach((d) => dl.remove(d.name))}>
                Clear finished
              </button>
            )}
          </div>
          {active.map((d) => <DownloadRow key={d.name} d={d} dl={dl} />)}
        </section>
      )}

      <div className="tabs discover-tabs">
        <button className={`tab ${source === 'ollama' ? 'active' : ''}`} onClick={() => setSource('ollama')}>Ollama Library</button>
        <button className={`tab ${source === 'hf' ? 'active' : ''}`} onClick={() => setSource('hf')}>Hugging Face</button>
      </div>

      {source === 'hf' ? <HuggingFaceView ollama={ollama} dl={dl} /> : (<>
      <div className="pull-bar">
        <Search size={16} />
        <input
          placeholder="Search suggestions or enter a model to pull (e.g. llama3.2:3b)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pullQuery()}
        />
        <button className="btn primary" disabled={!query.trim()} onClick={pullQuery}>
          <Download size={14} /> Pull
        </button>
      </div>

      <div className="cards">
        {filtered.map((s) => (
          <div key={s.name} className="card">
            <div className="card-head">
              <Telescope size={16} className="accent" />
              <span className="strong">{s.name}</span>
              {s.tags.map((t) => <span key={t} className="badge label">{t}</span>)}
            </div>
            <p className="muted small">{s.desc}</p>
            <div className="sizes">
              {s.sizes.map((size) => {
                const tag = `${s.name}:${size}`;
                const have = isInstalled(tag);
                const job = dl.downloads[tag];
                const pulling = job?.state === 'downloading';
                const resumable = job?.state === 'paused' || job?.state === 'error';
                return (
                  <button
                    key={size}
                    className={`chip ${have ? 'have' : ''}`}
                    disabled={have || pulling}
                    onClick={() => dl.start(tag)}
                    title={have ? 'Installed' : resumable ? `Resume ${tag}` : `Pull ${tag}`}
                  >
                    {pulling ? <Loader2 size={11} className="spin" /> : have ? <Check size={11} /> : resumable ? <Play size={11} /> : <Download size={11} />}
                    {size}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      </>)}
    </main>
  );
}

function DownloadRow({ d, dl }: { d: DownloadJob; dl: Downloads }) {
  const menu = useContextMenu();
  const pct = d.total ? Math.min(100, (d.completed / d.total) * 100) : 0;
  const detail =
    d.state === 'done'
      ? 'Downloaded'
      : [
          d.state === 'error' ? `Failed: ${d.error}` : d.status,
          d.total > 0 && `${api.formatBytes(d.completed)} / ${api.formatBytes(d.total)} (${pct.toFixed(0)}%)`,
          d.state === 'downloading' && d.bytesPerSec > 0 && `${api.formatBytes(d.bytesPerSec)}/s`,
          formatEta(d),
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div
      className={`download ${d.state}`}
      onContextMenu={(e) =>
        menu(e, [
          d.state === 'downloading' && { label: 'Pause', icon: Pause, onClick: () => dl.pause(d.name) },
          (d.state === 'paused' || d.state === 'error') && { label: d.state === 'error' ? 'Retry' : 'Resume', icon: Play, onClick: () => dl.resume(d.name) },
          'separator',
          { label: 'Copy model name', icon: Copy, onClick: () => copyText(d.name) },
          'separator',
          { label: d.state === 'done' ? 'Remove from list' : 'Cancel download', icon: X, danger: d.state !== 'done', onClick: () => dl.remove(d.name) },
        ])
      }
    >
      <div className="download-head">
        <span className="strong">{d.name}</span>
        <span className={`small ${d.state === 'error' ? 'error-text' : 'muted'}`}>{detail}</span>
        <span className="flex" />
        {d.state === 'downloading' && (
          <button className="icon-btn sm" title="Pause" onClick={() => dl.pause(d.name)}><Pause size={13} /></button>
        )}
        {d.state === 'paused' && (
          <button className="btn sm primary" onClick={() => dl.resume(d.name)}><Play size={12} /> Resume</button>
        )}
        {d.state === 'error' && (
          <button className="btn sm" onClick={() => dl.resume(d.name)}><RotateCcw size={12} /> Retry</button>
        )}
        {d.state === 'done' ? (
          <button className="icon-btn sm" title="Dismiss" onClick={() => dl.remove(d.name)}><Check size={13} /></button>
        ) : (
          <button className="icon-btn sm" title="Cancel download" onClick={() => dl.remove(d.name)}><X size={13} /></button>
        )}
      </div>
      <div className="progress"><div style={{ width: `${d.state === 'done' ? 100 : pct}%` }} /></div>
    </div>
  );
}
