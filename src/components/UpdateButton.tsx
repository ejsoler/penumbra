// The sidebar's update icon: shown only when a newer Penumbra is out (and not skipped). Clicking it
// opens a small card with what's new, a download with progress, and "Skip this version".
import { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, Download, ExternalLink, FolderOpen, Loader2, X } from './icons';
import { Markdown } from './Markdown';
import { isMac } from '../platform';
import { cancelDownload, downloadUpdate, installUpdate, revealDownload, setUpdateSettings, updateWaiting, useUpdates } from '../updates';

const mb = (n: number) => `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;

/** What's new, without the release page's download and install sections (this card handles those). */
const shortNotes = (notes: string) => {
  const lines = notes.replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l) => /^#{1,4}\s*(download|install|requirements|getting started)/i.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).slice(0, 60).join('\n').trim();
};

const installHint = () => {
  if (isMac) return 'Opens the disk image. Quit Penumbra, then drag the new version to Applications to replace the old one.';
  if (navigator.userAgent.includes('Windows')) return 'Penumbra closes so the installer can replace it. Your chats and settings are kept.';
  return 'Your chats and settings are kept.';
};

export function UpdateButton() {
  const s = useUpdates();
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !card.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.rail-update')) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!updateWaiting(s) || !s.info) return null;
  const { info, download: d } = s;
  const pct = d.total ? Math.min(100, Math.round((d.got / d.total) * 100)) : 0;

  return (
    <>
      <button className={`rail-btn rail-update ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} title={`Penumbra ${info.version} is available`}>
        <ArrowUpCircle size={19} />
        <span className="rail-dot still" />
      </button>
      {open && (
        <div className="update-card" ref={card} role="dialog" aria-label="Update available">
          <div className="update-head">
            <div>
              <div className="strong">Penumbra {info.version} is available</div>
              <div className="muted small">You have {info.current}{info.publishedAt ? ` · released ${new Date(info.publishedAt).toLocaleDateString()}` : ''}</div>
            </div>
            <button className="icon-btn sm" onClick={() => setOpen(false)} title="Close"><X size={14} /></button>
          </div>

          {info.notes && (
            <div className="update-notes">
              <Markdown text={shortNotes(info.notes)} />
            </div>
          )}

          {d.phase === 'downloading' && (
            <div className="update-progress">
              <div className="progress"><div style={{ width: `${pct}%` }} /></div>
              <span className="muted small">{d.total ? `${mb(d.got)} of ${mb(d.total)}` : 'Starting…'}</span>
            </div>
          )}
          {d.phase === 'done' && <p className="muted small">Saved to your Downloads folder. {installHint()}</p>}
          {d.phase === 'error' && <p className="update-error small">{d.error}</p>}
          {!info.file && <p className="muted small">This release has no installer for this computer. Get it from the release page.</p>}

          <div className="update-actions">
            <button className="btn ghost sm" onClick={() => { setUpdateSettings({ skipped: info.version ?? '' }); setOpen(false); }}>Skip this version</button>
            <span className="flex" />
            <a className="btn sm" href={info.url} target="_blank" rel="noreferrer" title="Release page on GitHub"><ExternalLink size={13} /> Notes</a>
            {info.file && d.phase === 'downloading' && <button className="btn sm" onClick={cancelDownload}>Cancel</button>}
            {info.file && d.phase === 'done' && <button className="btn sm" onClick={revealDownload} title="Show in folder"><FolderOpen size={13} /></button>}
            {info.file && d.phase === 'done' && <button className="btn primary sm" onClick={installUpdate}>{isMac ? 'Open installer' : 'Install'}</button>}
            {info.file && (d.phase === 'idle' || d.phase === 'error') && (
              <button className="btn primary sm" onClick={downloadUpdate} title={`${info.file.name} · ${mb(info.file.size)}`}>
                <Download size={13} /> {d.phase === 'error' ? 'Try again' : `Download · ${mb(info.file.size)}`}
              </button>
            )}
            {d.phase === 'downloading' && <Loader2 size={14} className="spin" />}
          </div>
        </div>
      )}
    </>
  );
}
