// Internet access for widgets and agents' web tools: the default for all chats (in the Options tab), and
// each chat's own setting (in its settings panel), which can change the mode and add sites.
import { useState } from 'react';
import { alwaysAllow, APPROVED_SITES, parseSite, removeAlwaysAllowed, setNetMode, useNetSettings, type ChatNet } from '../widgets/network';
import { Globe, TriangleAlert, X } from './icons';

/** A list of sites with remove buttons and a box to add one. */
function SiteList({ sites, onAdd, onRemove, taken = [] }: { sites: string[]; onAdd: (site: string) => void; onRemove: (site: string) => void; taken?: string[] }) {
  const [site, setSite] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    const r = parseSite(site);
    if ('error' in r) return setError(r.error);
    if (sites.includes(r.site)) return setError(`${r.site} is already on this list`);
    if (taken.includes(r.site)) return setError(`${r.site} is already on the list for all chats`);
    onAdd(r.site);
    setSite('');
    setError('');
  };
  return (
    <>
      {sites.map((h) => (
        <div key={h} className="row net-allowed">
          <span className="mono flex">{h}</span>
          <button className="icon-btn sm" title={`Remove ${h}`} onClick={() => onRemove(h)}><X size={12} /></button>
        </div>
      ))}
      <div className="row gap net-add">
        <input
          className="text"
          value={site}
          placeholder="api.example.com or *.example.com"
          aria-label="Add a site"
          onChange={(e) => { setSite(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn sm" disabled={!site.trim()} onClick={add}>Add</button>
      </div>
      {error && <span className="net-error">{error}</span>}
    </>
  );
}

/** Asks before letting widgets and agents reach any site. */
function ConfirmWholeInternet({ where, onYes, onNo }: { where: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="net-all-title">
        <div className="modal-icon warn"><Globe size={22} /></div>
        <h3 id="net-all-title">Let widgets and agents reach the whole internet {where}?</h3>
        <p>Widgets and agents are driven by the model. With this on, widgets can load from any https website and agents can open any page, without asking you.</p>
        <ul>
          <li><b>The model could send small pieces of your conversation to a website</b> inside a web address. This is most likely if you paste text, documents, or pages you don't trust, since they can trick the model.</li>
          <li><b>Still blocked:</b> uploads and posts, cookies, your computer and local network, and Ollama.</li>
          <li>You can see every request in each widget's network log and each agent's steps.</li>
        </ul>
        <div className="modal-actions">
          <button className="btn primary" autoFocus onClick={onNo}>Keep approved sites only</button>
          <button className="btn danger" onClick={onYes}>Allow whole internet</button>
        </div>
      </div>
    </div>
  );
}

const MODE_TEXT = { ask: 'Approved sites, ask for others', all: 'Whole internet', off: 'No internet' } as const;

/** One chat's internet access: the default for all chats, or its own mode, plus sites only this chat may use. */
export function ChatInternet({ net, setNet, onManageDefault }: { net?: ChatNet; setNet: (net: ChatNet | undefined) => void; onManageDefault: () => void }) {
  const defaults = useNetSettings();
  const [confirmAll, setConfirmAll] = useState(false);
  const mode = net?.mode ?? defaults.mode;
  const own = net?.allow ?? [];
  const save = (next: ChatNet) => setNet(next.mode || next.allow?.length ? next : undefined);
  const pick = (v: string) => {
    if (v === 'all') return setConfirmAll(true);
    save({ ...net, mode: v === 'default' ? undefined : (v as ChatNet['mode']) });
  };
  return (
    <section id="chat-internet">
      <h4>Internet access</h4>
      <select className="wide-select net-select" value={net?.mode ?? 'default'} onChange={(e) => pick(e.target.value)} aria-label="Internet access for this chat">
        <option value="default">Default for all chats</option>
        <option value="ask">{MODE_TEXT.ask}</option>
        <option value="all">{MODE_TEXT.all}</option>
        <option value="off">{MODE_TEXT.off}</option>
      </select>
      {mode === 'all' ? (
        <p className="net-note warn"><TriangleAlert size={12} /> {!net?.mode && 'Default: '}Widgets and agents in this chat reach any site without asking.</p>
      ) : mode === 'off' ? (
        <p className="net-note muted">Widgets run offline, and agents can't search or open pages in this chat.</p>
      ) : (
        <>
          <p className="net-note muted">
            {!net?.mode && 'Default: '}Approved sites{defaults.alwaysAllow.length ? `, your ${defaults.alwaysAllow.length} for all chats` : ''}{own.length ? `, and ${own.length} for this chat` : ''}; other sites ask first.
          </p>
          <div className="net-list">
            <b>Only in this chat</b>
            <SiteList
              sites={own}
              taken={defaults.alwaysAllow}
              onAdd={(site) => save({ ...net, allow: [...own, site] })}
              onRemove={(site) => save({ ...net, allow: own.filter((h) => h !== site) })}
            />
          </div>
        </>
      )}
      <button className="link-btn small" onClick={onManageDefault}>Change the default for all chats…</button>
      {confirmAll && <ConfirmWholeInternet where="in this chat" onNo={() => setConfirmAll(false)} onYes={() => { save({ ...net, mode: 'all' }); setConfirmAll(false); }} />}
    </section>
  );
}

/** Internet access for every chat: the mode, the built-in approved sites, and the user's own sites. */
export function InternetSettings() {
  const net = useNetSettings();
  const [confirmAll, setConfirmAll] = useState(false);
  const [showList, setShowList] = useState(false);
  return (
    <section className="panel" id="internet-access">
      <h4>Internet access <span className="muted small normal">default for all chats</span></h4>
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
          For widgets and agents' web tools. Maps, CDNs, and public data work right away; other sites ask first. Each chat can change this in its settings panel.{' '}
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
          <SiteList sites={net.alwaysAllow} onAdd={(site) => alwaysAllow([site])} onRemove={removeAlwaysAllowed} />
          <span>Widgets and agents in every chat can use these without asking. Still download-only: no uploads, cookies, or local network.</span>
        </div>
      )}
      {confirmAll && <ConfirmWholeInternet where="in every chat" onNo={() => setConfirmAll(false)} onYes={() => { setNetMode('all'); setConfirmAll(false); }} />}
    </section>
  );
}
