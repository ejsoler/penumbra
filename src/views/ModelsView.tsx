import { useEffect, useState, type MouseEvent } from 'react';
import * as api from '../api';
import type { OllamaState } from '../store';
import { CapabilityBadges } from '../components/ModelPicker';
import { Cloud, Copy, Cpu, Download, Eject, ExternalLink, Info, Loader2, MessageSquarePlus, Search, Trash2, X } from '../components/icons';
import { copyText, useContextMenu } from '../components/ContextMenu';

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function expiresIn(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s > 86400 * 365) return 'never';
  if (s < 60) return 'soon';
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  return `in ${(s / 3600).toFixed(1)}h`;
}

/** Where a model lives online: Hugging Face for hf.co/ pulls, otherwise the Ollama library. */
function modelUrl(name: string) {
  const hf = /^(?:hf\.co|huggingface\.co)\/([^:]+)/.exec(name);
  if (hf) return `https://huggingface.co/${hf[1]}`;
  const [base, tag] = name.split(':');
  return `https://ollama.com/${base.includes('/') ? base : `library/${base}`}${tag && tag !== 'latest' ? `:${tag}` : ''}`;
}

export function ModelsView({ ollama, onChatWith }: { ollama: OllamaState; onChatWith: (model: string) => void }) {
  const menu = useContextMenu();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [error, setError] = useState('');

  const running = new Map(ollama.running.map((r) => [r.name, r]));
  const models = ollama.models.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
  const totalSize = ollama.models.reduce((n, m) => n + m.size, 0);

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError('');
    try {
      await fn();
      await ollama.refresh();
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const modelMenu = (e: MouseEvent, m: api.LocalModel) => {
    const loaded = running.has(m.name);
    const caps = ollama.capabilities[m.name] ?? [];
    const canLoad = !m.remote_host && !caps.includes('embedding');
    menu(e, [
      !caps.includes('embedding') && { label: 'New chat with this model', icon: MessageSquarePlus, onClick: () => onChatWith(m.name) },
      canLoad && (loaded
        ? { label: 'Eject from memory', icon: Eject, onClick: () => act(m.name, () => api.unloadModel(m.name)) }
        : { label: 'Load into memory', icon: Download, onClick: () => act(m.name, () => api.loadModel(m.name)) }),
      'separator',
      { label: 'Copy name', icon: Copy, onClick: () => copyText(m.name) },
      { label: 'Copy run command', icon: Copy, onClick: () => copyText(`ollama run ${m.name}`) },
      { label: 'Details', icon: Info, onClick: () => setDetails(m.name) },
      { label: m.name.startsWith('hf.co/') ? 'Open on Hugging Face' : 'Open on ollama.com', icon: ExternalLink, onClick: () => window.open(modelUrl(m.name), '_blank') },
      'separator',
      { label: 'Delete from disk…', icon: Trash2, danger: true, onClick: () => confirm(`Delete ${m.name}? This removes it from disk.`) && act(m.name, () => api.deleteModel(m.name)) },
    ]);
  };

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>My Models</h1>
          <p className="muted">
            {ollama.models.length} models · {api.formatBytes(totalSize)} on disk · {ollama.running.length} loaded
          </p>
        </div>
        <div className="search-box">
          <Search size={14} />
          <input placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </header>

      {ollama.running.length > 0 && (
        <section className="loaded-strip">
          <h4>Loaded in memory</h4>
          <div className="loaded-cards">
            {ollama.running.map((r) => (
              <div
                key={r.name}
                className="loaded-card"
                onContextMenu={(e) => {
                  const m = ollama.models.find((x) => x.name === r.name);
                  if (m) modelMenu(e, m);
                }}
              >
                <Cpu size={16} className="accent" />
                <div>
                  <div className="strong">{r.name}</div>
                  <div className="muted mono small">
                    {api.formatBytes(r.size_vram)} VRAM{r.size > r.size_vram ? ` · ${api.formatBytes(r.size - r.size_vram)} RAM` : ''}
                    {r.context_length ? ` · ctx ${r.context_length.toLocaleString()}` : ''}
                    {' · '}unloads {expiresIn(r.expires_at)}
                  </div>
                </div>
                <button className="btn sm" onClick={() => act(r.name, () => api.unloadModel(r.name))}>
                  <Eject size={13} /> Eject
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <div className="banner error">{error}<button className="icon-btn sm" onClick={() => setError('')}><X size={13} /></button></div>}

      <div className="table">
        <div className="tr th">
          <span>Model</span><span>Params</span><span>Quant</span><span>Family</span><span>Size</span><span>Modified</span><span />
        </div>
        {models.map((m) => {
          const r = running.get(m.name);
          const caps = ollama.capabilities[m.name] ?? [];
          return (
            <div key={m.name} className="tr" onContextMenu={(e) => modelMenu(e, m)}>
              <span className="model-cell">
                <span className={`dot ${r ? 'on' : ''}`} />
                <span className="strong">{m.name}</span>
                {m.remote_host && <Cloud size={13} className="muted" />}
                <CapabilityBadges caps={caps} />
              </span>
              <span className="mono">{m.details.parameter_size || '—'}</span>
              <span className="mono">{m.details.quantization_level || '—'}</span>
              <span>{m.details.family || '—'}</span>
              <span className="mono">{m.size > 1e6 ? api.formatBytes(m.size) : '—'}</span>
              <span className="muted">{timeAgo(m.modified_at)}</span>
              <span className="row-actions">
                {busy === m.name ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <>
                    {!m.remote_host && !caps.includes('embedding') && (r ? (
                      <button className="btn sm" onClick={() => act(m.name, () => api.unloadModel(m.name))}>Eject</button>
                    ) : (
                      <button className="btn sm primary" onClick={() => act(m.name, () => api.loadModel(m.name))}>Load</button>
                    ))}
                    <button className="icon-btn sm" title="Details" onClick={() => setDetails(m.name)}><Info size={14} /></button>
                    <button
                      className="icon-btn sm danger"
                      title="Delete model"
                      onClick={() => confirm(`Delete ${m.name}? This removes it from disk.`) && act(m.name, () => api.deleteModel(m.name))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
        {models.length === 0 && <div className="empty-small pad">No models. Head to Discover to download one.</div>}
      </div>

      {details && <DetailsDrawer name={details} onClose={() => setDetails(null)} />}
    </main>
  );
}

function DetailsDrawer({ name, onClose }: { name: string; onClose: () => void }) {
  const [info, setInfo] = useState<api.ShowResponse | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'template' | 'modelfile' | 'license'>('overview');

  useEffect(() => {
    setInfo(null);
    api.showModel(name).then(setInfo).catch((e) => setError(e.message));
  }, [name]);

  const mi = info?.model_info ?? {};
  const arch = String(mi['general.architecture'] ?? info?.details?.family ?? '');
  const pick = (k: string) => mi[`${arch}.${k}`] as number | undefined;
  const facts: [string, string | number | undefined][] = [
    ['Architecture', arch],
    ['Parameters', info?.details?.parameter_size ?? (mi['general.parameter_count'] ? `${(Number(mi['general.parameter_count']) / 1e9).toFixed(1)}B` : undefined)],
    ['Quantization', info?.details?.quantization_level],
    ['Format', info?.details?.format],
    ['Max context', pick('context_length')?.toLocaleString()],
    ['Embedding size', pick('embedding_length')],
    ['Layers', pick('block_count')],
    ['Attention heads', pick('attention.head_count')],
    ['Capabilities', info?.capabilities?.join(', ')],
  ];

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h3>{name}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="tabs">
          {(['overview', 'template', 'modelfile', 'license'] as const).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <div className="drawer-body">
          {error && <div className="banner error">{error}</div>}
          {!info && !error && <Loader2 className="spin" />}
          {info && tab === 'overview' && (
            <>
              <dl className="facts">
                {facts.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              {info.parameters && (
                <>
                  <h4>Default parameters</h4>
                  <pre className="pre">{info.parameters}</pre>
                </>
              )}
              {info.system && (
                <>
                  <h4>Default system prompt</h4>
                  <pre className="pre">{info.system}</pre>
                </>
              )}
            </>
          )}
          {info && tab === 'template' && <pre className="pre">{info.template || 'No template.'}</pre>}
          {info && tab === 'modelfile' && <pre className="pre">{info.modelfile || 'No modelfile.'}</pre>}
          {info && tab === 'license' && <pre className="pre">{info.license || 'No license information.'}</pre>}
        </div>
      </div>
    </div>
  );
}
