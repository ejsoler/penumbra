// Connections → Penumbra as a server: let other apps (Claude Desktop, Cursor, scripts) use Penumbra through MCP.
import { useEffect, useState } from 'react';
import { copyText } from './ContextMenu';
import { Check, Copy, Eye, Plug, RefreshCw, ShieldAlert, Trash2 } from './icons';
import { host } from '../host';
import { CAPS, refreshMcpServerStatus, regenerateToken, setMcpServerSettings, useMcpServerSettings, useMcpServerStatus } from '../mcpServer';

export function McpServerPanel() {
  const s = useMcpServerSettings();
  const st = useMcpServerStatus();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  const [port, setPort] = useState(String(s.port));
  useEffect(() => {
    void refreshMcpServerStatus();
    const t = setInterval(() => void refreshMcpServerStatus(), 3000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setPort(String(s.port)), [s.port]);

  const port0 = st.port || s.port;
  const url = `http://127.0.0.1:${port0}/mcp`;
  const token = s.token || '(turn the server on to make a token)';
  const shown = (real: string) => (show ? real : real.replace(/[0-9a-f]{12,}/g, '••••••••••••••••'));
  const http = (t: string) => JSON.stringify({ mcpServers: { penumbra: { type: 'http', url, headers: { Authorization: `Bearer ${t}` } } } }, null, 2);
  const claudeCode = (t: string) => `claude mcp add --transport http penumbra ${url} --header "Authorization: Bearer ${t}"`;
  const stdio = (t: string) => JSON.stringify({ mcpServers: { penumbra: { command: st.exe || 'node', args: [st.bridge || 'penumbra-mcp-bridge.cjs'], env: { ELECTRON_RUN_AS_NODE: '1', PENUMBRA_MCP_URL: url, PENUMBRA_MCP_TOKEN: t } } } }, null, 2);
  const copy = (id: string, text: string) => {
    copyText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 1800);
  };
  const anyOn = Object.values(s.caps).some(Boolean);

  return (
    <div className="editor">
      <header className="page-head">
        <div>
          <h1><Plug size={20} className="accent" /> Penumbra as a server</h1>
          <p className="muted">Let other apps use Penumbra through MCP: ask your local models, read your chats, manage projects, make images. You decide what they may do, and Penumbra asks you before it happens.</p>
        </div>
      </header>

      <section className="panel">
        <label className="check-row mcps-main">
          <input type="checkbox" checked={s.enabled} disabled={!host()} onChange={(e) => setMcpServerSettings({ enabled: e.target.checked })} />
          <span><b>Let other apps connect</b></span>
          <span className={`mcp-status ${st.running ? 'on' : st.error ? 'error' : 'off'}`}>
            <span className={`mcp-dot ${st.running ? 'on' : st.error ? 'error' : 'off'}`} />
            {st.running ? `Listening on 127.0.0.1:${st.port}${st.clients.length ? ` · ${st.clients.join(', ')}` : ''}` : st.error ? 'Not running' : 'Off'}
          </span>
        </label>
        {st.error && <pre className="mcp-error">{st.error}</pre>}
        <p className="net-note warn"><ShieldAlert size={13} /> Only apps on this computer can reach it, and only with the token below. Anyone who has the token can do what you allow here, so keep it private.</p>
        <label className="field slim">
          <span>Port</span>
          <input
            className="num"
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onBlur={() => {
              const n = Math.round(Number(port));
              if (n >= 1024 && n <= 65535 && n !== s.port) setMcpServerSettings({ port: n });
              else setPort(String(s.port));
            }}
          />
        </label>
        <div className="field slim column">
          <span>Token <small className="muted">the secret apps send to connect</small></span>
          <div className="row gap">
            <code className="mcps-token">{s.token ? (show ? s.token : '••••••••••••••••••••••••') : 'none yet'}</code>
            <button className="icon-btn sm" title={show ? 'Hide' : 'Show'} onClick={() => setShow(!show)} disabled={!s.token}><Eye size={13} /></button>
            <button className="icon-btn sm" title="Copy" onClick={() => copy('token', s.token)} disabled={!s.token}>{copied === 'token' ? <Check size={13} /> : <Copy size={13} />}</button>
            <button className="btn sm" onClick={() => confirm('Make a new token? Apps using the old one are cut off until you give them the new one.') && regenerateToken()}><RefreshCw size={12} /> New token</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h4>What apps may do</h4>
        <p className="muted small">Everything starts off. Each kind is allowed on its own, and “Ask me” shows a window in Penumbra each time an app wants to use one of its tools, with “Always allow” for that tool.</p>
        <div className="mcps-caps">
          {CAPS.map((c) => (
            <div key={c.id} className={`mcps-cap ${s.caps[c.id] ? 'on' : ''}`}>
              <label className="check-row">
                <input type="checkbox" checked={s.caps[c.id]} onChange={(e) => setMcpServerSettings({ caps: { ...s.caps, [c.id]: e.target.checked } })} />
                <span><b>{c.label}</b></span>
                <span className="flex" />
                <label className="check-row mcps-ask" title="Show a window each time an app uses one of these tools">
                  <input type="checkbox" checked={s.confirm[c.id]} disabled={!s.caps[c.id]} onChange={(e) => setMcpServerSettings({ confirm: { ...s.confirm, [c.id]: e.target.checked } })} />
                  <span className="small">Ask me</span>
                </label>
              </label>
              <div className="muted small">{c.description}</div>
              <div className="mono small muted mcps-tools">{c.tools.join(' · ')}</div>
            </div>
          ))}
        </div>
        {s.enabled && !anyOn && <p className="net-note warn">The server is on, but no kind of tool is allowed yet, so apps see nothing to use.</p>}
        {s.allowed.length > 0 && (
          <div className="mcps-allowed">
            <span className="muted small">Always allowed:</span>
            {s.allowed.map((t) => (
              <span key={t} className="badge label mcps-chip">
                {t}
                <button className="icon-btn sm" title="Ask again for this tool" onClick={() => setMcpServerSettings({ allowed: s.allowed.filter((x) => x !== t) })}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h4>Connect an app</h4>
        <p className="muted small">Most apps take a block like this in their MCP settings. For an app that accepts a web address, use the first block; for Claude Code, the one-line command; for an app that only starts programs (Claude Desktop), the last, which runs a small bridge included with Penumbra.</p>
        <div className="mcps-snippet">
          <div className="codeblock-head"><span>A web address (HTTP)</span><button className="link-btn small" onClick={() => copy('http', http(s.token || '<token>'))}>{copied === 'http' ? 'Copied' : 'Copy'}</button></div>
          <pre className="step-result">{shown(http(token))}</pre>
        </div>
        <div className="mcps-snippet">
          <div className="codeblock-head"><span>Claude Code (run in a terminal)</span><button className="link-btn small" onClick={() => copy('cc', claudeCode(s.token || '<token>'))}>{copied === 'cc' ? 'Copied' : 'Copy'}</button></div>
          <pre className="step-result">{shown(claudeCode(token))}</pre>
        </div>
        <div className="mcps-snippet">
          <div className="codeblock-head"><span>A program (stdio, for Claude Desktop and similar)</span><button className="link-btn small" onClick={() => copy('stdio', stdio(s.token || '<token>'))}>{copied === 'stdio' ? 'Copied' : 'Copy'}</button></div>
          <pre className="step-result">{shown(stdio(token))}</pre>
        </div>
        <p className="muted small">Penumbra has to be open for apps to reach it. The “ask” and “orchestrator” tools show up in Penumbra as chats titled “MCP · …”, so you can read what the app did.</p>
      </section>
    </div>
  );
}
