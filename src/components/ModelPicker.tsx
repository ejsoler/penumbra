import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, ChevronDown, Cloud, Eject, Eye, Brain, Loader2, Search, Wrench } from './icons';
import * as api from '../api';
import type { OllamaState } from '../store';

interface Props {
  ollama: OllamaState;
  value: string;
  onChange: (model: string) => void;
  keepAlive: string;
  numCtx: number;
}

export function CapabilityBadges({ caps }: { caps: string[] }) {
  return (
    <span className="badges">
      {caps.includes('vision') && <span className="badge" title="Vision"><Eye size={11} /></span>}
      {caps.includes('tools') && <span className="badge" title="Tool use"><Wrench size={11} /></span>}
      {caps.includes('thinking') && <span className="badge" title="Reasoning"><Brain size={11} /></span>}
      {caps.includes('embedding') && <span className="badge label">embed</span>}
    </span>
  );
}

export function ModelPicker({ ollama, value, onChange, keepAlive, numCtx }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const loaded = useMemo(() => new Set(ollama.running.map((r) => r.name)), [ollama.running]);
  const filtered = ollama.models.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  const select = async (name: string) => {
    onChange(name);
    setOpen(false);
    setError('');
    if (loaded.has(name) || ollama.capabilities[name]?.includes('embedding')) return;
    const model = ollama.models.find((m) => m.name === name);
    if (model?.remote_host) return; // cloud models don't load locally
    setLoading(name);
    try {
      await api.loadModel(name, keepAlive, { num_ctx: numCtx });
      await ollama.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const eject = async (name: string) => {
    await api.unloadModel(name).catch(() => {});
    ollama.refresh();
  };

  const current = ollama.models.find((m) => m.name === value);

  return (
    <div className="picker" ref={ref}>
      <button className={`picker-btn ${value ? 'has-model' : ''}`} onClick={() => setOpen(!open)}>
        {loading ? <Loader2 size={15} className="spin" /> : <Box size={15} />}
        <span className="picker-label">
          {value || 'Select a model to load'}
          {loading && <span className="muted"> — loading…</span>}
        </span>
        {current && <span className="muted mono">{current.details.parameter_size}</span>}
        {!value && <kbd>⌘L</kbd>}
        <ChevronDown size={15} />
      </button>
      {value && loaded.has(value) && (
        <button className="icon-btn" title="Eject model from memory" onClick={() => eject(value)}>
          <Eject size={15} />
        </button>
      )}
      {error && <div className="picker-error">{error}</div>}
      {open && (
        <div className="picker-menu">
          <div className="picker-search">
            <Search size={14} />
            <input autoFocus placeholder="Filter models…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="picker-list">
            {filtered.length === 0 && <div className="empty-small">No models found. Download one from Discover.</div>}
            {filtered.map((m) => {
              const caps = ollama.capabilities[m.name] ?? [];
              return (
                <button
                  key={m.name}
                  className={`picker-item ${m.name === value ? 'active' : ''}`}
                  disabled={caps.includes('embedding')}
                  title={caps.includes('embedding') ? 'Embedding models cannot be used for chat' : undefined}
                  onClick={() => select(m.name)}
                >
                  <span className={`dot ${loaded.has(m.name) ? 'on' : ''}`} title={loaded.has(m.name) ? 'Loaded' : ''} />
                  <span className="picker-item-name">{m.name}</span>
                  {m.remote_host && <Cloud size={13} className="muted" />}
                  <CapabilityBadges caps={caps} />
                  <span className="muted mono">{m.details.parameter_size}</span>
                  <span className="muted mono">{m.details.quantization_level}</span>
                  <span className="muted mono right">{m.size > 1e6 ? api.formatBytes(m.size) : ''}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
