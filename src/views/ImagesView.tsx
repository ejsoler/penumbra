// The Images tab: make images with local image models, manage them, and find more on Hugging Face.
// Runs outside Ollama, with stable-diffusion.cpp (see electron/images.cjs).
import { useEffect, useState } from 'react';
import { usePersistent } from '../store';
import { openLightbox } from '../components/Lightbox';
import { host, type GeneratedImage, type ImageModel, type SaveDir } from '../host';
import { compact, listQuants, searchModels, type HfModel, type HfQuant } from '../hf';
import { formatBytes } from '../api';
import { cleanError, dismissDownload, generateImage, modelLabel, readyModels, refreshImages, useImages } from '../images';
import { ChevronDown, ChevronRight, Download, FolderOpen, ImageIcon, Loader2, Search, Sparkles, Square, Trash2, X } from '../components/icons';

type Tab = 'create' | 'models' | 'find';

/** "~/Pictures/Penumbra" instead of the full home path. */
const tidyPath = (p: string) => p.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Z]:\\Users\\[^\\]+/, '~');

/** Extra downloads the first model of each family brings: the engine and the family's shared files. */
const FAMILY_EXTRA: Record<string, string> = { zimage: 'about 2.9 GB', flux: 'about 5.7 GB' };
const SIZES = [
  { label: 'Square', w: 1024, h: 1024 },
  { label: 'Portrait', w: 768, h: 1024 },
  { label: 'Landscape', w: 1024, h: 768 },
  { label: 'Small', w: 512, h: 512 },
];
const isAdult = (tags: string[]) => tags.includes('not-for-all-audiences');

export function ImagesView() {
  const { status, downloads } = useImages();
  const [tab, setTab] = usePersistent<Tab>('ollama-gui.imagesTab', 'create');
  const ready = readyModels(status);
  const active = Object.values(downloads);

  if (!host()) return <main className="page"><p className="muted">Image generation needs the desktop app.</p></main>;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1><ImageIcon size={20} className="accent" /> Images</h1>
          <p className="muted">Make images on this computer with image models from Hugging Face. Runs outside Ollama, with stable-diffusion.cpp.</p>
        </div>
        <div className="seg seg-wide">
          <button className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}><Sparkles size={13} /> Create</button>
          <button className={tab === 'models' ? 'on' : ''} onClick={() => setTab('models')}>My models{status?.models.length ? ` (${status.models.length})` : ''}</button>
          <button className={tab === 'find' ? 'on' : ''} onClick={() => setTab('find')}><Search size={13} /> Find models</button>
        </div>
      </header>

      {status && !status.supported && <div className="banner warn">stable-diffusion.cpp doesn't have a build for this computer yet (it supports Apple Silicon Macs, and x64 Windows and Linux).</div>}

      {active.length > 0 && (
        <section className="panel">
          <h4>Downloads</h4>
          {active.map((d) => <DownloadRow key={d.id} id={d.id} />)}
        </section>
      )}

      {tab === 'create' && (ready.length ? <Create models={ready} /> : (
        <section className="panel images-empty">
          <ImageIcon size={32} className="accent" />
          <h3>No image models yet</h3>
          <p className="muted">Find one on Hugging Face. Z-Image Turbo is a good start: fast, and about 7 GB at Q8 (smaller quantizations are a bit lower in quality).</p>
          <button className="btn primary" onClick={() => setTab('find')}><Search size={14} /> Find models</button>
        </section>
      ))}
      {tab === 'models' && <Models models={status?.models ?? []} engine={status?.engine?.version} />}
      {tab === 'find' && <Find installed={status?.models ?? []} onDone={() => setTab('create')} />}
    </main>
  );
}

function DownloadRow({ id }: { id: string }) {
  const d = useImages().downloads[id];
  if (!d) return null;
  const pct = d.total ? Math.min(100, Math.round(((d.got ?? 0) / d.total) * 100)) : 0;
  const name = id.split(':')[0].split('/')[1] ?? id;
  return (
    <div className={`download ${d.phase === 'error' ? 'error' : d.phase === 'done' ? 'done' : ''}`}>
      <div className="row gap img-dl-head">
        <span className="strong flex">{name}</span>
        <span className="muted small">
          {d.phase === 'engine' ? `Getting the image engine… ${formatBytes(d.got ?? 0)} of ${formatBytes(d.total ?? 0)}`
            : d.phase === 'downloading' ? `${d.file} · ${formatBytes(d.got ?? 0)} of ${formatBytes(d.total ?? 0)} (${pct}%)`
            : d.phase === 'done' ? 'Ready'
            : d.phase === 'cancelled' ? 'Cancelled'
            : d.error}
        </span>
        {d.phase === 'engine' || d.phase === 'downloading'
          ? <button className="btn sm" onClick={() => host()!.images.cancel(id)}>Cancel</button>
          : <button className="icon-btn sm" title="Dismiss" onClick={() => dismissDownload(id)}><X size={13} /></button>}
      </div>
      {(d.phase === 'engine' || d.phase === 'downloading') && <div className="progress"><div style={{ width: `${d.phase === 'engine' && d.total ? ((d.got ?? 0) / d.total) * 100 : pct}%` }} /></div>}
    </div>
  );
}

// ---- create ---------------------------------------------------------------------------------------

function Create({ models }: { models: ImageModel[] }) {
  const { generating } = useImages();
  const [modelId, setModelId] = usePersistent('ollama-gui.imageModel', '');
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const [prompt, setPrompt] = usePersistent('ollama-gui.imagePrompt', '');
  const [size, setSize] = usePersistent('ollama-gui.imageSize', 0);
  const [steps, setSteps] = useState('');
  const [seed, setSeed] = useState('');
  const [result, setResult] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState('');
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const loadGallery = () => host()!.images.gallery(12).then(setGallery).catch(() => {});
  const [saveDir, setSaveDir] = useState<SaveDir | null>(null);
  useEffect(() => {
    host()!.images.saveDir().then(setSaveDir).catch(() => {});
  }, []);
  useEffect(() => {
    loadGallery();
  }, []);

  const go = async () => {
    if (!model || !prompt.trim() || generating) return;
    setError('');
    try {
      const s = SIZES[size] ?? SIZES[0];
      const r = await generateImage({ id: model.id, prompt: prompt.trim(), width: s.w, height: s.h, ...(steps ? { steps: Number(steps) } : {}), ...(seed ? { seed: Number(seed) } : {}) });
      setResult(r);
      loadGallery();
    } catch (e) {
      const msg = cleanError(e);
      if (msg !== 'Stopped') setError(msg);
    }
  };
  const pct = generating ? (generating.phase === 'sampling' && generating.steps ? (generating.step / generating.steps) * 100 : generating.phase === 'decoding' ? 100 : 3) : 0;

  return (
    <div className="images-create">
      <section className="panel">
        <label className="field column">
          <span>Prompt</span>
          <textarea
            className="instructions"
            rows={4}
            value={prompt}
            placeholder="A cozy lighthouse on a cliff at sunset, warm light in the windows, painterly style"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && go()}
          />
        </label>
        <div className="images-opts">
          <label className="field slim column">
            <span>Model</span>
            <select className="wide-select" value={model?.id} onChange={(e) => setModelId(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)} · {m.familyLabel}{m.nsfw ? ' · 18+' : ''}</option>)}
            </select>
          </label>
          <div className="field slim column">
            <span>Size</span>
            <div className="seg">
              {SIZES.map((s, i) => <button key={s.label} className={size === i ? 'on' : ''} title={`${s.w}×${s.h}`} onClick={() => setSize(i)}>{s.label}</button>)}
            </div>
          </div>
          <label className="field slim column">
            <span>Steps <small className="muted">blank = model default</small></span>
            <input className="num wide" type="number" min={1} max={60} value={steps} onChange={(e) => setSteps(e.target.value)} />
          </label>
          <label className="field slim column">
            <span>Seed <small className="muted">blank = random</small></span>
            <input className="num wide" type="number" min={0} value={seed} onChange={(e) => setSeed(e.target.value)} />
          </label>
        </div>
        <div className="row gap images-go">
          {generating ? (
            <>
              <div className="flex update-progress">
                <div className="progress"><div style={{ width: `${pct}%` }} /></div>
                <span className="muted small">
                  {generating.phase === 'loading' ? `Loading the model${generating.steps ? ` ${Math.round((generating.step / generating.steps) * 100)}%` : '…'} (the first image takes longest)` : generating.phase === 'decoding' ? 'Finishing…' : `Step ${generating.step} of ${generating.steps}`}
                </span>
              </div>
              <button className="btn" onClick={() => host()!.images.stop()}><Square size={12} fill="currentColor" /> Stop</button>
            </>
          ) : (
            <>
              <span className="flex muted small">{error ? <span className="red">{error}</span> : 'Runs on this computer. ⌘/Ctrl+Enter generates.'}</span>
              <button className="btn primary" disabled={!prompt.trim()} onClick={go}><Sparkles size={14} /> Generate</button>
            </>
          )}
        </div>
      </section>

      <section className="panel save-dir">
        <div className="row gap">
          <FolderOpen size={15} className="muted" />
          <div className="save-dir-text">
            <span className="small">Saves to <button className="link-btn mono save-dir-path" title={saveDir ? `${saveDir.dir} (open)` : ''} onClick={() => host()!.images.reveal()}>{saveDir ? tidyPath(saveDir.dir) : '…'}</button></span>
            <span className="muted small">In a chat with a folder, images go to that folder instead.</span>
          </div>
          {saveDir && !saveDir.isDefault && <button className="btn ghost sm" onClick={async () => setSaveDir(await host()!.images.resetSaveDir())}>Reset</button>}
          <button className="btn sm" onClick={async () => setSaveDir(await host()!.images.chooseSaveDir())}>Change…</button>
        </div>
      </section>

      {result && (
        <section className="panel images-result">
          <img src={result.image} alt={result.prompt ?? ''} title="Click to enlarge" className="zoomable" onClick={() => openLightbox([{ src: result.image, alt: result.prompt, caption: result.prompt, file: result.file }])} />
          <div className="row gap">
            <span className="muted small flex">{result.width}×{result.height} · {result.steps} steps · seed {result.seed}</span>
            <button className="btn sm" onClick={() => setSeed(String(result.seed))} title="Use this seed again">Reuse seed</button>
            <button className="btn sm" onClick={() => host()!.images.reveal(result.file)}><FolderOpen size={13} /> Show in folder</button>
          </div>
        </section>
      )}

      {gallery.length > 0 && (
        <section className="panel">
          <h4>Recent</h4>
          <div className="images-gallery">
            {gallery.map((g) => (
              <div key={g.file} className="images-thumb">
                <img src={g.image} alt={g.prompt ?? ''} title={g.prompt} onClick={() => openLightbox(gallery.map((x) => ({ src: x.image, alt: x.prompt, caption: x.prompt, file: x.file })), gallery.indexOf(g))} />
                <button className="icon-btn sm thumb-reuse" title="Use this prompt and seed" onClick={() => { setResult(g); if (g.prompt) setPrompt(g.prompt); if (g.seed !== undefined) setSeed(String(g.seed)); }}>↺</button>
                <button className="icon-btn sm" title="Delete" onClick={async () => { await host()!.images.deleteOutput(g.file); loadGallery(); if (result?.file === g.file) setResult(null); }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---- my models ------------------------------------------------------------------------------------

function Models({ models, engine }: { models: ImageModel[]; engine?: string }) {
  if (!models.length) return <section className="panel"><p className="muted small">No image models yet. Find one in <b>Find models</b>.</p></section>;
  return (
    <section className="panel">
      {models.map((m) => (
        <div key={m.id} className="img-model">
          <div className="flex">
            <div className="strong">{modelLabel(m)} {m.nsfw && <span className="badge warn">18+</span>}</div>
            <div className="muted small">{m.familyLabel} · {formatBytes(m.size)} · {m.repo}{m.ready ? '' : ` · missing ${m.missing.join(', ')}`}</div>
          </div>
          <button className="btn danger sm" onClick={async () => { if (confirm(`Delete ${modelLabel(m)}? It frees ${formatBytes(m.size)}.`)) { await host()!.images.remove(m.id); refreshImages(); } }}><Trash2 size={13} /> Delete</button>
        </div>
      ))}
      <div className="row gap img-foot">
        <span className="muted small flex">Image engine: stable-diffusion.cpp {engine ?? '(not installed yet)'}. Shared files (VAE and text encoders) are kept for all models of a family.</span>
        <button className="btn sm" onClick={() => host()!.images.openModels()}><FolderOpen size={13} /> Open folder</button>
      </div>
    </section>
  );
}

// ---- find -----------------------------------------------------------------------------------------

function Find({ installed, onDone }: { installed: ImageModel[]; onDone: () => void }) {
  const [query, setQuery] = useState('z-image');
  const [adult, setAdult] = usePersistent('ollama-gui.imagesShowAdult', false);
  const [results, setResults] = useState<HfModel[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const search = async (q = query) => {
    setBusy(true);
    setError('');
    try {
      setResults(await searchModels(q, 'downloads', 40, 'text-to-image'));
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    search();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (results ?? []).filter((r) => adult || !isAdult(r.tags));
  const hidden = (results?.length ?? 0) - shown.length;
  return (
    <section className="panel">
      <div className="row gap">
        <input className="text" value={query} placeholder="Search image models: z-image, flux…" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn" onClick={() => search()} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Search</button>
      </div>
      <div className="row gap img-find-opts">
        <span className="muted small flex">GGUF image models on Hugging Face. Supported now: Z-Image and FLUX.1.</span>
        <label className="check-row inline">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span className="small">Show 18+ models{!adult && hidden ? ` (${hidden} hidden)` : ''}</span>
        </label>
      </div>
      {error && <p className="red small">{error}</p>}
      {results && !shown.length && <p className="muted small">No image models found.</p>}
      <div className="img-results">
        {shown.map((r) => (
          <Result key={r.id} model={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} installed={installed} onDone={onDone} />
        ))}
      </div>
    </section>
  );
}

function Result({ model, open, onToggle, installed, onDone }: { model: HfModel; open: boolean; onToggle: () => void; installed: ImageModel[]; onDone: () => void }) {
  const { downloads } = useImages();
  const [files, setFiles] = useState<HfQuant[] | null>(null);
  const [kind, setKind] = useState<{ family: string | null; label?: string | null; reason: string | null } | null>(null);
  const [error, setError] = useState('');
  const adult = isAdult(model.tags);

  useEffect(() => {
    if (!open || files) return;
    (async () => {
      try {
        const q = (await listQuants(model.id)).filter((f) => !f.split);
        setFiles(q);
        if (q[0]) {
          const r = await host()!.images.inspect(model.id, q[0].files[0]);
          setKind({ family: r.family, label: r.familyLabel, reason: r.reason });
        }
      } catch (e) {
        setError(cleanError(e));
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const get = async (file: string) => {
    if (adult && !confirm(`${model.id} is marked "not for all audiences" on Hugging Face. It can make adult images, even from ordinary prompts. Download it?`)) return;
    try {
      await host()!.images.download({ repo: model.id, file, nsfw: adult });
    } catch (e) {
      setError(cleanError(e));
    }
  };
  const firstOfFamily = kind?.family && !installed.some((m) => m.family === kind.family);

  return (
    <div className={`img-result ${open ? 'open' : ''}`}>
      <button className="img-result-head" onClick={onToggle}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="strong flex">{model.id}</span>
        {adult && <span className="badge warn">18+</span>}
        <span className="muted small"><Download size={11} /> {compact(model.downloads)} · ♥ {compact(model.likes)}</span>
      </button>
      {open && (
        <div className="img-files">
          {error && <p className="red small">{error}</p>}
          {!files && !error && <p className="muted small"><Loader2 size={12} className="spin" /> Reading the repo…</p>}
          {kind && (kind.family
            ? <p className="muted small">{kind.label} model.{firstOfFamily ? ` The first ${kind.label} model also downloads the image engine and shared files (${FAMILY_EXTRA[kind.family] ?? 'a few GB'}).` : ''}</p>
            : <p className="amber small">{kind.reason}</p>)}
          {files?.map((f) => {
            const id = `${model.id}:${f.files[0]}`;
            const have = installed.some((m) => m.id === id);
            const d = downloads[id];
            const busy = d && (d.phase === 'engine' || d.phase === 'downloading');
            return (
              <div key={f.quant} className="img-file">
                <span className="mono small flex">{f.files[0].split('/').pop()}</span>
                <span className="muted small">{formatBytes(f.size)}</span>
                {have ? (
                  <button className="btn sm" onClick={onDone}>Use it</button>
                ) : (
                  <button className="btn primary sm" disabled={!kind?.family || busy} onClick={() => get(f.files[0])}>{busy ? <Loader2 size={13} className="spin" /> : <Download size={13} />} Download</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
