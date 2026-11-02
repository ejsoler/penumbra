// The Updates tab: the installed version, a newer one if there is one, what's new in it (the full release
// notes), and the download and install. The sidebar's arrow icon opens it when an update is waiting.
import { ArrowUpCircle, Download, ExternalLink, FolderOpen, Loader2, RefreshCw } from '../components/icons';
import { Markdown } from '../components/Markdown';
import { host } from '../host';
import { isMac } from '../platform';
import { cancelDownload, checkForUpdates, downloadUpdate, installUpdate, revealDownload, setUpdateSettings, useUpdates } from '../updates';

const mb = (n: number) => `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;

/** What's new, without the release page's download and install sections (this page handles those). */
const shortNotes = (notes: string) => {
  const lines = notes.replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l) => /^#{1,4}\s*(download|install|requirements|getting started|first launch)/i.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
};

const installHint = () => {
  if (isMac) return 'Opens the disk image. Quit Penumbra, then drag the new version to Applications to replace the old one.';
  if (navigator.userAgent.includes('Windows')) return 'Penumbra closes so the installer can replace it. Your chats and settings are kept.';
  return 'Your chats and settings are kept.';
};

export function UpdatesView() {
  const u = useUpdates();
  const { info, settings, download: d } = u;
  if (!host()) return <main className="page"><p className="muted">Updates need the desktop app.</p></main>;
  const pct = d.total ? Math.min(100, Math.round((d.got / d.total) * 100)) : 0;
  const skipped = !!info?.available && settings.skipped === info.version;

  return (
    <main className="page updates-page">
      <header className="page-head">
        <div>
          <h1><ArrowUpCircle size={20} className="accent" /> Updates</h1>
          <p className="muted">You have Penumbra <span className="mono">{info?.current ?? '…'}</span>.</p>
        </div>
        <button className="btn sm" onClick={checkForUpdates} disabled={u.checking}>
          {u.checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Check now
        </button>
      </header>

      <section className="panel update-status">
        {u.error ? (
          <p className="update-error">Couldn't check: {u.error}</p>
        ) : !info ? (
          <p className="muted">{u.checking ? 'Checking…' : 'Not checked yet.'}</p>
        ) : !info.available ? (
          <p>You're up to date.</p>
        ) : (
          <>
            <div>
              <h3>Penumbra {info.version} is available</h3>
              <p className="muted small">
                You have {info.current}{info.publishedAt ? ` · released ${new Date(info.publishedAt).toLocaleDateString()}` : ''}
                {info.file ? ` · ${mb(info.file.size)}` : ''}
                {skipped ? ' · you skipped this version' : ''}
              </p>
            </div>

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
              {info.file && (d.phase === 'idle' || d.phase === 'error') && (
                <button className="btn primary sm" onClick={downloadUpdate} title={info.file.name}>
                  <Download size={13} /> {d.phase === 'error' ? 'Try again' : 'Download'}
                </button>
              )}
              {info.file && d.phase === 'downloading' && <button className="btn sm" onClick={cancelDownload}>Cancel</button>}
              {info.file && d.phase === 'done' && <button className="btn primary sm" onClick={installUpdate}>{isMac ? 'Open installer' : 'Install'}</button>}
              {info.file && d.phase === 'done' && <button className="btn sm" onClick={revealDownload}><FolderOpen size={13} /> Show in folder</button>}
              <a className="btn sm" href={info.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Release page</a>
              <span className="flex" />
              {skipped ? (
                <button className="btn ghost sm" onClick={() => setUpdateSettings({ skipped: '' })}>Show the sidebar icon again</button>
              ) : (
                <button className="btn ghost sm" onClick={() => setUpdateSettings({ skipped: info.version ?? '' })} title="Hide the sidebar icon until the next version">Skip this version</button>
              )}
            </div>
          </>
        )}
      </section>

      {info?.available && info.notes && (
        <section className="panel update-notes-page">
          <h4>What's new in {info.version}</h4>
          <Markdown text={shortNotes(info.notes)} />
        </section>
      )}

      <section className="panel">
        <label className="check-row">
          <input type="checkbox" checked={settings.auto} onChange={(e) => setUpdateSettings({ auto: e.target.checked })} />
          <span>Check for updates automatically <span className="muted">(asks GitHub for the latest release twice a day; nothing else is sent)</span></span>
        </label>
      </section>
    </main>
  );
}
