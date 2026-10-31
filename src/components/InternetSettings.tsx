// Internet access for widgets and agents' web tools, set once for all chats (shown in the Options tab).
import { useState } from 'react';
import { alwaysAllow, APPROVED_SITES, parseSite, removeAlwaysAllowed, setNetMode, useNetSettings } from '../widgets/network';
import { Globe, TriangleAlert, X } from './icons';

/** Internet access for every chat: the mode, the built-in approved sites, and the user's own sites. */
export function InternetSettings() {
  const net = useNetSettings();
  const [confirmAll, setConfirmAll] = useState(false);
  const [showList, setShowList] = useState(false);
  const [site, setSite] = useState('');
  const [siteError, setSiteError] = useState('');
  const addSite = () => {
    const r = parseSite(site);
    if ('error' in r) return setSiteError(r.error);
    if (net.alwaysAllow.includes(r.site)) return setSiteError(`${r.site} is already on your list`);
    alwaysAllow([r.site]);
    setSite('');
    setSiteError('');
  };
  return (
    <section className="panel" id="internet-access">
      <h4>Internet access <span className="muted small normal">all chats</span></h4>
      <label className="field">
        <span>Access</span>
        <select value={net.mode} onChange={(e) => (e.target.value === 'all' ? setConfirmAll(true) : setNetMode('ask'))}>
          <option value="ask">Approved sites, ask for others</option>
          <option value="all">Whole internet</option>
        </select>
      </label>
      {net.mode === 'all' ? (
        <p className="net-note warn"><TriangleAlert size={12} /> Widgets and agents can reach any site without asking.</p>
      ) : (
        <p className="net-note muted">
          For widgets and agents' web tools, in every chat. Maps, CDNs, and public data work right away; other sites ask first.{' '}
          <button className="link-btn" onClick={() => setShowList(!showList)}>{showList ? 'Hide list' : 'See list'}</button>
        </p>
      )}
      {showList && net.mode === 'ask' && (
        <div className="net-list">
          {APPROVED_SITES.map((g) => (
            <div key={g.group}><b>{g.group}</b><div className="mono">{g.hosts.join(', ')}</div></div>
          ))}
        </div>
      )}
      {net.mode === 'ask' && (
        <div className="net-list">
          <b>Your sites</b>
          {net.alwaysAllow.map((h) => (
            <div key={h} className="row net-allowed">
              <span className="mono flex">{h}</span>
              <button className="icon-btn sm" title={`Remove ${h}`} onClick={() => removeAlwaysAllowed(h)}><X size={12} /></button>
            </div>
          ))}
          <div className="row gap net-add">
            <input
              className="text"
              value={site}
              placeholder="api.example.com or *.example.com"
              aria-label="Add a site"
              onChange={(e) => { setSite(e.target.value); setSiteError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && addSite()}
            />
            <button className="btn sm" disabled={!site.trim()} onClick={addSite}>Add</button>
          </div>
          {siteError ? <span className="net-error">{siteError}</span> : <span>Widgets and agents can use these without asking. Still download-only: no uploads, cookies, or local network.</span>}
        </div>
      )}
      {confirmAll && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="net-all-title">
            <div className="modal-icon warn"><Globe size={22} /></div>
            <h3 id="net-all-title">Let widgets and agents reach the whole internet?</h3>
            <p>Widgets and agents are driven by the model. With this on, widgets can load from any https website and agents can open any page, without asking you.</p>
            <ul>
              <li><b>The model could send small pieces of your conversation to a website</b> inside a web address. This is most likely if you paste text, documents, or pages you don't trust, since they can trick the model.</li>
              <li><b>Still blocked:</b> uploads and posts, cookies, your computer and local network, and Ollama.</li>
              <li>You can see every request in each widget's network log and each agent's steps.</li>
            </ul>
            <div className="modal-actions">
              <button className="btn primary" autoFocus onClick={() => setConfirmAll(false)}>Keep approved sites only</button>
              <button className="btn danger" onClick={() => { setNetMode('all'); setConfirmAll(false); }}>Allow whole internet</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
