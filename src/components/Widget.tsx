import { useEffect, useRef, useState } from 'react';
import { buildWidgetDocument, widgetTitle, WIDGET_CSP } from '../widgets/document';
import { copyText, useContextMenu } from './ContextMenu';
import { Check, Code, Copy, LayoutDashboard, Loader2, RefreshCw } from './icons';

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 1400;

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

function WidgetFrame({ code, title }: { code: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT * 2);
  const [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const menu = useContextMenu();

  useEffect(() => {
    let cancelled = false;
    setError('');
    buildWidgetDocument(code)
      .then((d) => !cancelled && setDoc(d))
      .catch((e) => !cancelled && setError(`Could not prepare widget: ${(e as Error).message}`));
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Only trust messages from this widget's own frame.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow || !e.data || e.data.__penumbra !== 1) return;
      const msg = e.data as { type: string; height?: number; message?: string };
      if (msg.type === 'resize' && typeof msg.height === 'number' && Number.isFinite(msg.height)) {
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, msg.height)));
      } else if (msg.type === 'error' && typeof msg.message === 'string') {
        setError(msg.message);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const copy = () => {
    copyText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const reload = () => {
    setError('');
    setReloadKey((k) => k + 1);
  };

  return (
    <div
      className="widget"
      onContextMenu={(e) =>
        menu(e, [
          { label: 'Reload', icon: RefreshCw, onClick: reload },
          { label: showCode ? 'Hide code' : 'View code', icon: Code, onClick: () => setShowCode(!showCode) },
          { label: 'Copy code', icon: Copy, onClick: copy },
        ])
      }
    >
      <div className="widget-head">
        <LayoutDashboard size={14} />
        <span className="widget-title">{title}</span>
        <span className="flex" />
        <button className={`icon-btn sm ${showCode ? 'on' : ''}`} title={showCode ? 'Hide code' : 'View code'} onClick={() => setShowCode(!showCode)}>
          <Code size={14} />
        </button>
        <button className="icon-btn sm" title="Copy code" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        <button className="icon-btn sm" title="Reload" onClick={reload}><RefreshCw size={14} /></button>
      </div>
      {showCode && <pre className="widget-code">{code}</pre>}
      {doc ? (
        <iframe
          key={reloadKey}
          ref={frameRef}
          className="widget-frame"
          title={title}
          sandbox="allow-scripts"
          srcDoc={doc}
          referrerPolicy="no-referrer"
          style={{ height }}
          {...{ csp: WIDGET_CSP }}
        />
      ) : (
        !error && <div className="widget-building"><Loader2 size={15} className="spin" /> Loading…</div>
      )}
      {error && <div className="widget-error">⚠ {error}</div>}
    </div>
  );
}
