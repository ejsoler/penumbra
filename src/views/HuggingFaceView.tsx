import { useEffect, useState } from 'react';
import * as api from '../api';
import * as hf from '../hf';
import type { OllamaState } from '../store';
import type { Downloads } from '../downloads';
import { Check, Copy, Download, Heart, Loader2, Pause, Play, Search, ExternalLink } from '../components/icons';
import { copyText, useContextMenu } from '../components/ContextMenu';

const SORTS: { id: hf.HfSort; label: string }[] = [
  { id: 'trendingScore', label: 'Trending' },
  { id: 'downloads', label: 'Most downloads' },
  { id: 'likes', label: 'Most likes' },
  { id: 'lastModified', label: 'Recently updated' },
];

export function HuggingFaceView({ ollama, dl }: { ollama: OllamaState; dl: Downloads }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<hf.HfSort>('trendingScore');
  const [results, setResults] = useState<hf.HfModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const menu = useContextMenu();

  // Debounced search; a "user/repo" or URL opens that repo directly.
  useEffect(() => {
    const t = setTimeout(async () => {
      const repo = query.includes('/') ? hf.parseRepo(query) : null;
      if (repo) setSelected(repo);
      setLoading(true);
      setError('');
      try {
        setResults(await hf.searchModels(repo ?? query, sort));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, sort]);

  return (
    <div className="hf">
      <div className="hf-toolbar">
        <div className="pull-bar hf-search">
          <Search size={16} />
          <input
            placeholder="Search GGUF models on Hugging Face, or paste a repo (e.g. unsloth/Qwen3-8B-GGUF)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading && <Loader2 size={15} className="spin" />}
        </div>
        <select className="hf-sort" value={sort} onChange={(e) => setSort(e.target.value as hf.HfSort)}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="hf-split">
        <div className="hf-results">
          {!loading && results.length === 0 && !error && <div className="empty-small pad">No GGUF models found.</div>}
          {results.map((m) => {
            const [owner, name] = m.id.split('/');
            return (
              <button
                key={m.id}
                className={`hf-item ${selected === m.id ? 'active' : ''}`}
                onClick={() => setSelected(m.id)}
                onContextMenu={(e) =>
                  menu(e, [
                    { label: 'Show quantizations', icon: Download, onClick: () => setSelected(m.id) },
                    { label: 'Open on Hugging Face', icon: ExternalLink, onClick: () => window.open(`https://huggingface.co/${m.id}`, '_blank') },
                    'separator',
                    { label: 'Copy repo ID', icon: Copy, onClick: () => copyText(m.id) },
                  ])
                }
              >
                <div className="hf-item-name">
                  <span className="muted">{owner}/</span>
                  <span className="strong">{name}</span>
                </div>
                <div className="hf-item-meta muted small">
                  <span><Download size={11} /> {hf.compact(m.downloads)}</span>
                  <span><Heart size={11} /> {hf.compact(m.likes)}</span>
                  {m.pipeline_tag && <span>{m.pipeline_tag}</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="hf-detail">
          {selected ? (
            <RepoDetail key={selected} repo={selected} ollama={ollama} dl={dl} />
          ) : (
            <div className="empty-small pad">Select a model to see its available quantizations.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function RepoDetail({ repo, ollama, dl }: { repo: string; ollama: OllamaState; dl: Downloads }) {
  const [quants, setQuants] = useState<hf.HfQuant[] | null>(null);
  const [error, setError] = useState('');
  const installed = new Set(ollama.models.map((m) => m.name.toLowerCase()));
  const menu = useContextMenu();

  useEffect(() => {
    hf.listQuants(repo).then(setQuants).catch((e) => setError(e.message));
  }, [repo]);

  const recommended = hf.RECOMMENDED.find((r) => quants?.some((q) => q.quant === r && !q.split));

  return (
    <div className="repo">
      <div className="repo-head">
        <h3>{repo}</h3>
        <a className="icon-btn sm" href={`https://huggingface.co/${repo}`} target="_blank" rel="noreferrer" title="Open on Hugging Face">
          <ExternalLink size={14} />
        </a>
      </div>
      <p className="muted small">
        Pulled as <code>hf.co/{repo}:&lt;quant&gt;</code>. Lower-bit quants are smaller and faster; higher-bit quants are more accurate.
      </p>

      {error && <div className="banner error">{error}</div>}
      {!quants && !error && <Loader2 className="spin" />}
      {quants && quants.length === 0 && <div className="empty-small">No GGUF files in this repo.</div>}

      {quants && quants.length > 0 && (
        <div className="quant-list">
          {quants.map((q) => {
            const name = hf.ollamaName(repo, q.quant);
            const have = installed.has(name.toLowerCase());
            const job = dl.downloads[name];
            const pulling = job?.state === 'downloading';
            const resumable = job?.state === 'paused' || job?.state === 'error';
            return (
              <div
                key={q.quant}
                className={`quant ${q.split ? 'dim' : ''}`}
                onContextMenu={(e) =>
                  menu(e, [
                    !have && !pulling && !q.split && { label: resumable ? `Resume ${q.quant}` : `Download ${q.quant}`, icon: resumable ? Play : Download, onClick: () => dl.start(name) },
                    pulling && { label: 'Pause download', icon: Pause, onClick: () => dl.pause(name) },
                    job && job.state !== 'done' && { label: 'Cancel download', icon: Download, danger: true, onClick: () => dl.remove(name) },
                    'separator',
                    { label: 'Copy model name', icon: Copy, onClick: () => copyText(name) },
                    { label: 'Copy pull command', icon: Copy, onClick: () => copyText(`ollama pull ${name}`) },
                    { label: 'Open file on Hugging Face', icon: ExternalLink, onClick: () => window.open(`https://huggingface.co/${repo}/blob/main/${q.files[0]}`, '_blank') },
                  ])
                }
              >
                <span className="mono strong quant-name">{q.quant}</span>
                {q.quant === recommended && <span className="badge label">recommended</span>}
                {q.split && <span className="badge label warn" title="Ollama can't pull GGUFs split into multiple files">split files</span>}
                <span className="flex" />
                <span className="muted mono">{api.formatBytes(q.size)}</span>
                {have ? (
                  <span className="chip have"><Check size={11} /> Installed</span>
                ) : pulling ? (
                  <button className="chip" title="Pause" onClick={() => dl.pause(name)}>
                    <Loader2 size={11} className="spin" /> {job.total ? `${Math.round((job.completed / job.total) * 100)}%` : 'Starting'} <Pause size={11} />
                  </button>
                ) : resumable ? (
                  <button className="btn sm" onClick={() => dl.start(name)}>
                    <Play size={12} /> Resume{job.total ? ` (${Math.round((job.completed / job.total) * 100)}%)` : ''}
                  </button>
                ) : (
                  <button className="btn sm primary" disabled={q.split} onClick={() => dl.start(name)}>
                    <Download size={12} /> Download
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
