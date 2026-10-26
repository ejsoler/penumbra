import { createContext, useContext, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { buildWidgetDocument, widgetCsp, widgetTitle } from '../widgets/document';
import {
  alwaysAllow, decide, forgetDecision, isLocalHost, useNetSettings, widgetAccess, widgetId, type WidgetRequest,
} from '../widgets/network';
import { copyText, downloadFile, useContextMenu } from './ContextMenu';
import {
  Check, Code, Copy, FileDown, Globe, LayoutDashboard, Loader2, Maximize2, RefreshCw, ShieldCheck, WandSparkles, WifiOff, X,
} from './icons';

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 1400;

/** What a widget can ask the chat to do. Provided by the chat view. */
export interface WidgetActions {
  /** Puts a follow-up question in the message box; the user decides whether to send it. */
  ask: (text: string) => void;
  /** Sends the widget's error back to the model and asks for a corrected version. */
  fix: (title: string, error: string) => void;
  /** A reply is being generated, so fixing has to wait. */
  busy: boolean;
}

export const WidgetActionsContext = createContext<WidgetActions | null>(null);

const fileSlug = (s: string) => s.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'widget';

/** A model-written HTML/JS answer, rendered in a locked-down iframe. */
export function Widget({ code, live }: { code: string; live: boolean }) {
  const title = widgetTitle(code);
  const lines = code.split('\n').length;

  if (live) {
    return (
      <div className="widget building">
        <div className="widget-head">
          <LayoutDashboard size={14} />
          <span className="widget-title">{title}</span>
        </div>
        <div className="widget-building">
          <Loader2 size={15} className="spin" />
          Building interactive answer… <span className="muted mono">{lines} lines</span>
        </div>
      </div>
    );
  }
  return <WidgetFrame code={code} title={title} />;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/** Shown instead of the widget until the user answers for sites outside the approved list. */
function NetworkConsent({ id, title, hosts }: { id: string; title: string; hosts: string[] }) {
  return (
    <div className="widget">
      <div className="widget-head">
        <LayoutDashboard size={14} />
        <span className="widget-title">{title}</span>
      </div>
      <div className="widget-consent">
        <div className="consent-title"><Globe size={15} /> This widget wants to connect to:</div>
        <ul className="consent-hosts">{hosts.map((h) => <li key={h} className="mono">{h}</li>)}</ul>
        <p className="muted small">
          <ShieldCheck size={12} /> Widgets can only download from websites, never upload or post. Cookies and your local network
          are always blocked, and every request shows in the widget's network log.
        </p>
        <div className="row gap">
          <button className="btn sm primary" onClick={() => decide(id, { allow: hosts })}>Allow</button>
          <button className="btn sm" onClick={() => { alwaysAllow(hosts); decide(id, { allow: hosts }); }}>Always allow {hosts.length > 1 ? 'these sites' : 'this site'}</button>
          <button className="btn sm ghost" onClick={() => decide(id, { allow: [], offline: true })}><WifiOff size={13} /> Run offline</button>
        </div>
      </div>
    </div>
  );
}

let instances = 0;

function WidgetFrame({ code, title }: { code: string; title: string }) {
  const net = useNetSettings();
  const id = widgetId(code);
  const access = widgetAccess(code, net);
  if (access.pending.length) return <NetworkConsent id={id} title={title} hosts={access.pending} />;
  return <WidgetRunner code={code} title={title} id={id} hosts={access.hosts} offline={access.offline} mode={net.mode} />;
}

function WidgetRunner({ code, title, id, hosts, offline, mode }: {
  code: string;
  title: string;
  id: string;
  hosts: string[] | 'all';
  offline: boolean;
  mode: 'ask' | 'all';
}) {
  const actions = useContext(WidgetActionsContext);
  const net = useNetSettings();
  const hostsKey = hosts === 'all' ? 'all' : hosts.join(' ');
  const [instance] = useState(() => `pw${++instances}`);
  const [requests, setRequests] = useState<WidgetRequest[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [showNet, setShowNet] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT * 2);
  const [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const menu = useContextMenu();
  // Runaway-growth guard: a widget whose height keeps climbing (a layout feedback loop) gets frozen.
  const growth = useRef({ count: 0, since: 0, frozen: false });
  const heightRef = useRef(MIN_HEIGHT * 2);
  const lastAsk = useRef(0);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    let cancelled = false;
    setError('');
    setBlocked([]);
    buildWidgetDocument(code, { hosts })
      .then((d) => !cancelled && setDoc(d))
      .catch((e) => !cancelled && setError(`Could not prepare widget: ${(e as Error).message}`));
    return () => {
      cancelled = true;
    };
  }, [code, hostsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The main process reports every request this widget's frame makes (see electron/main.cjs).
  useEffect(
    () =>
      window.penumbraHost?.onWidgetRequest((r) => {
        if (!r.frame.startsWith(`${instance}-`)) return;
        setRequests((rs) => [...rs.slice(-199), r]);
        if (r.blocked === 'site not allowed for widgets') noteBlocked(r.url);
      }),
    [instance], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const noteBlocked = (url: string) => {
    const host = hostOf(url);
    // Local addresses are never allowed, so don't offer them.
    if (host && !isLocalHost(host) && mode === 'ask' && !offline) setBlocked((b) => (b.includes(host) ? b : [...b, host]));
  };
  const allowBlocked = () => {
    const prev = net.decisions[id]?.allow ?? [];
    decide(id, { allow: [...new Set([...prev, ...blocked])] });
  };

  // Only trust messages from this widget's own frame.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow || !e.data || e.data.__penumbra !== 1) return;
      const msg = e.data as { type: string; height?: number; message?: string; text?: string; url?: string };
      if (msg.type === 'resize' && typeof msg.height === 'number' && Number.isFinite(msg.height)) {
        const g = growth.current;
        if (g.frozen) return;
        const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, msg.height));
        if (next > heightRef.current) {
          const now = performance.now();
          if (now - g.since > 3000) Object.assign(g, { count: 0, since: now });
          if (++g.count > 25) {
            g.frozen = true;
            return;
          }
        }
        heightRef.current = next;
        setHeight(next);
      } else if (msg.type === 'error' && typeof msg.message === 'string') {
        setError(msg.message);
      } else if (msg.type === 'blocked' && typeof msg.url === 'string') {
        noteBlocked(msg.url);
      } else if (msg.type === 'followup' && typeof msg.text === 'string' && msg.text.trim()) {
        // A widget can't spam the message box: one follow-up per second at most.
        const now = performance.now();
        if (now - lastAsk.current < 1000) return;
        lastAsk.current = now;
        actionsRef.current?.ask(msg.text.trim());
        setFull(false);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const copy = () => {
    copyText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const reload = () => {
    setError('');
    setRequests([]);
    growth.current = { count: 0, since: 0, frozen: false };
    setReloadKey((k) => k + 1);
  };
  const save = async () => downloadFile(`${fileSlug(title)}.html`, await buildWidgetDocument(code, { standalone: true, hosts }), 'text/html');
  const failed = requests.filter((r) => r.blocked || r.failed).length;
  const fix = () => actions?.fix(title, error);
  const canFix = !!actions && !actions.busy;

  const head = (
    <div className="widget-head">
      <LayoutDashboard size={14} />
      <span className="widget-title">{title}</span>
      {offline && <span className="widget-badge" title="You chose to run this widget without internet"><WifiOff size={11} /> Offline</span>}
      <span className="flex" />
      {requests.length > 0 && (
        <button className={`icon-btn sm net-btn ${showNet ? 'on' : ''} ${failed ? 'warn' : ''}`} title="Network activity" onClick={() => setShowNet(!showNet)}>
          <Globe size={14} /> <span className="mono">{requests.length}</span>
        </button>
      )}
      <button className={`icon-btn sm ${showCode ? 'on' : ''}`} title={showCode ? 'Hide code' : 'View code'} onClick={() => setShowCode(!showCode)}>
        <Code size={14} />
      </button>
      <button className="icon-btn sm" title="Copy code" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      <button className="icon-btn sm" title="Save as HTML file" onClick={save}><FileDown size={14} /></button>
      <button className="icon-btn sm" title="Reload" onClick={reload}><RefreshCw size={14} /></button>
      {full ? (
        <button className="icon-btn sm" title="Exit full screen (Esc)" onClick={() => setFull(false)}><X size={15} /></button>
      ) : (
        <button className="icon-btn sm" title="Full screen" onClick={() => setFull(true)}><Maximize2 size={14} /></button>
      )}
    </div>
  );

  const body = (
    <>
      {showCode && <pre className="widget-code">{code}</pre>}
      {showNet && (
        <div className="widget-net">
          <div className="widget-net-head muted small">
            Requests from this widget{mode === 'all' ? ' (whole internet mode)' : ''}. Widgets can only download: uploads, cookies, and the local network are blocked.
          </div>
          {requests.map((r, i) => (
            <div key={i} className={`net-row ${r.blocked || r.failed ? 'bad' : r.cancelled ? 'dim' : ''}`}>
              <span className="mono net-status">{r.blocked ? 'blocked' : r.failed ? 'failed' : r.cancelled ? 'cancelled' : r.status}</span>
              <span className="mono net-url" title={r.url}><b>{hostOf(r.url)}</b>{r.url.replace(/^https?:\/\/[^/]+/, '')}</span>
              {(r.blocked || r.failed) && <span className="net-why">{r.blocked || r.failed}</span>}
            </div>
          ))}
        </div>
      )}
      {blocked.length > 0 && (
        <div className="widget-blocked">
          <span className="widget-error-text"><Globe size={13} /> Blocked a connection to <b>{blocked.join(', ')}</b>.</span>
          <button className="btn sm" onClick={allowBlocked}>Allow for this widget</button>
        </div>
      )}
      {doc ? (
        <iframe
          key={`${reloadKey}-${hostsKey}`}
          name={`${instance}-${reloadKey}`}
          ref={frameRef}
          className="widget-frame"
          title={title}
          sandbox="allow-scripts"
          srcDoc={doc}
          referrerPolicy="no-referrer"
          style={full ? undefined : { height }}
          {...{ csp: widgetCsp(hosts) }}
        />
      ) : (
        !error && <div className="widget-building"><Loader2 size={15} className="spin" /> Loading…</div>
      )}
      {error && (
        <div className="widget-error">
          <span className="widget-error-text">⚠ {error}</span>
          {actions && (
            <button
              className="btn sm"
              disabled={!canFix}
              title={canFix ? 'Send this error to the model and ask for a corrected widget' : 'Wait for the current reply to finish'}
              onClick={fix}
            >
              <WandSparkles size={13} /> Ask model to fix
            </button>
          )}
        </div>
      )}
    </>
  );

  const onContextMenu = (e: MouseEvent) =>
    menu(e, [
      { label: full ? 'Exit full screen' : 'Full screen', icon: Maximize2, onClick: () => setFull(!full) },
      { label: 'Reload', icon: RefreshCw, onClick: reload },
      'separator',
      { label: showCode ? 'Hide code' : 'View code', icon: Code, onClick: () => setShowCode(!showCode) },
      { label: 'Copy code', icon: Copy, onClick: copy },
      { label: 'Save as HTML…', icon: FileDown, onClick: save },
      requests.length > 0 && { label: showNet ? 'Hide network activity' : 'Show network activity', icon: Globe, onClick: () => setShowNet(!showNet) },
      !!net.decisions[id] && { label: 'Ask again about internet access', icon: Globe, onClick: () => forgetDecision(id) },
      !!error && !!actions && 'separator',
      !!error && !!actions && { label: 'Ask model to fix', icon: WandSparkles, onClick: fix, disabled: !canFix },
    ]);

  // Full screen moves the frame into an overlay, which restarts the widget (iframes reload when moved).
  if (full) {
    return (
      <>
        <div className="widget placeholder">
          <div className="widget-head">
            <LayoutDashboard size={14} />
            <span className="widget-title">{title}</span>
          </div>
          <div className="widget-building">Open in full screen</div>
        </div>
        {createPortal(
          <div className="widget-overlay" onMouseDown={(e) => e.target === e.currentTarget && setFull(false)}>
            <div className="widget full" role="dialog" aria-modal="true" aria-label={title} onContextMenu={onContextMenu}>
              {head}
              {body}
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <div className="widget" onContextMenu={onContextMenu}>
      {head}
      {body}
    </div>
  );
}
