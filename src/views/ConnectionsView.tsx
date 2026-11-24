// The Connections tab: apps and programs Penumbra connects to over MCP, and the tools they offer.
import { useEffect, useState } from 'react';
import { host } from '../host';
import {
  addServer, connectServer, DEFAULT_TIMEOUT, disconnectServer, joinCommand, MCP_EXAMPLES, parsePairs, pairsText, removeServer, splitCommand, updateServer,
  useMcpRuntime, useMcpServers, type McpServer, type McpStatus,
} from '../mcp';
import { usePersistent } from '../store';
import { Check, Loader2, Plug, Plus, ShieldAlert, Trash2, TriangleAlert, X } from '../components/icons';

const STATUS: Record<McpStatus, string> = { off: 'Not connected', connecting: 'Connecting…', on: 'Connected', error: "Couldn't connect" };

export function ConnectionsView({ onOpenAgents }: { onOpenAgents: () => void }) {
  const servers = useMcpServers();
  const runtime = useMcpRuntime();
  const [selected, setSelected] = usePersistent<string | null>('ollama-gui.mcpSelected', null);
  const server = servers.find((s) => s.id === selected) ?? servers[0];

  const add = (fields: Partial<McpServer> = {}) => setSelected(addServer(fields).id);
  /** An example server; the filesystem one needs a folder first. */
  const addExample = async (id: string) => {
    const ex = MCP_EXAMPLES.find((e) => e.id === id)!;
    let command = ex.command;
    if (ex.needs === 'folder') {
      const folder = await host()?.tools.pickFolder();
      if (!folder) return;
      command = joinCommand([...splitCommand(ex.command), folder]);
    }
    const [program, ...args] = splitCommand(command);
    const s = addServer({ name: ex.name, command: program, args });
    setSelected(s.id);
    connectServer(s.id);
  };

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="sidebar-title">Connections</span>
          <button className="icon-btn" onClick={() => add()} title="Add a server"><Plus size={16} /></button>
        </div>
        <div className="conv-list">
          {servers.length === 0 && <p className="muted small pad">No connections yet. Connect an app or program that speaks MCP, and its tools show up in your chats.</p>}
          {servers.map((s) => {
            const r = runtime[s.id];
            return (
              <div key={s.id} className={`conv-item ${s.id === server?.id ? 'active' : ''}`} onClick={() => setSelected(s.id)}>
                <span className={`mcp-dot ${r?.status ?? 'off'}`} />
                <div className="conv-text">
                  <span className="conv-title">{s.name}</span>
                  <span className="conv-sub">{r?.status === 'on' ? `${r.tools.length} ${r.tools.length === 1 ? 'tool' : 'tools'}` : STATUS[r?.status ?? 'off']}</span>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
      <main className="page connections-page">
        {server ? (
          <ServerPage key={server.id} server={server} onDeleted={() => setSelected(null)} onOpenAgents={onOpenAgents} />
        ) : (
          <div className="editor">
            <header className="page-head">
              <div>
                <h1><Plug size={20} className="accent" /> Connections</h1>
                <p className="muted">Connect Penumbra to other apps and programs through MCP (Model Context Protocol), so a chat or an agent can use their tools: read files, search a database, control an app. Turn on <b>Connected apps</b> in a chat's tools, or on an agent, to let it use them.</p>
              </div>
            </header>
            <section className="panel">
              <h4>Start with an example</h4>
              <div className="mcp-examples">
                {MCP_EXAMPLES.map((e) => (
                  <button key={e.id} className="mcp-example" onClick={() => addExample(e.id)}>
                    <b>{e.name}</b>
                    <span className="muted small">{e.description}</span>
                  </button>
                ))}
              </div>
              <p className="muted small">These need Node.js (for npx) or uv installed on this computer; the first start downloads them. Or add your own server with + .</p>
              <button className="btn" onClick={() => add()}><Plus size={14} /> Add a server</button>
            </section>
          </div>
        )}
      </main>
    </>
  );
}

function ServerPage({ server, onDeleted, onOpenAgents }: { server: McpServer; onDeleted: () => void; onOpenAgents: () => void }) {
  const rt = useMcpRuntime()[server.id] ?? { status: 'off' as McpStatus, tools: [] };
  // What's typed stays here until it's saved with the Save button.
  const [draft, setDraft] = useState(() => toDraft(server));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  useEffect(() => setDraft(toDraft(server)), [server.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(server));
  const ready = draft.transport === 'http' ? !!draft.url.trim() : !!draft.line.trim();
  const busy = rt.status === 'connecting';

  const save = () => {
    const [command = '', ...args] = splitCommand(draft.line);
    const next = {
      name: draft.name.trim() || 'Untitled server',
      transport: draft.transport,
      command,
      args,
      env: parsePairs(draft.env, '='),
      url: draft.url.trim(),
      headers: parsePairs(draft.headers, ':'),
      enabled: draft.enabled,
      timeoutSec: Math.max(5, Math.min(3600, Math.round(Number(draft.timeout)) || DEFAULT_TIMEOUT)),
    };
    updateServer(server.id, next);
    setDraft(toDraft({ ...server, ...next }));
    connectServer(server.id);
  };

  return (
    <div className="editor">
      <header className="page-head">
        <div className="project-title">
          <Plug size={20} className="accent" />
          <input className="plan-input strong flex" value={draft.name} placeholder="Name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="row gap">
          <span className={`mcp-status ${rt.status}`}>
            {busy ? <Loader2 size={12} className="spin" /> : <span className={`mcp-dot ${rt.status}`} />} {STATUS[rt.status]}
          </span>
          {rt.status === 'on' || busy ? (
            <button className="btn sm" disabled={busy} onClick={() => disconnectServer(server.id)}>Disconnect</button>
          ) : (
            <button className="btn sm primary" disabled={!ready || dirty} title={dirty ? 'Save your changes first' : undefined} onClick={() => connectServer(server.id)}>Connect</button>
          )}
        </div>
      </header>

      {rt.status === 'error' && rt.error && <pre className="mcp-error">{rt.error}</pre>}

      <section className="panel">
        <h4>Connection</h4>
        <label className="field slim column">
          <span>Type</span>
          <select className="wide-select" value={draft.transport} onChange={(e) => setDraft({ ...draft, transport: e.target.value as 'stdio' | 'http' })}>
            <option value="stdio">A program on this computer (stdio)</option>
            <option value="http">A web address (HTTP)</option>
          </select>
        </label>
        {draft.transport === 'stdio' ? (
          <>
            <label className="field slim column">
              <span>Command <small className="muted">the program and its arguments</small></span>
              <input className="text plain mono" value={draft.line} placeholder='npx -y @modelcontextprotocol/server-filesystem "/Users/me/Documents"' onChange={(e) => setDraft({ ...draft, line: e.target.value })} />
            </label>
            <label className="field slim column">
              <span>Environment <small className="muted">one NAME=value per line, for keys the program needs</small></span>
              <textarea className="plan-text mono" rows={3} value={draft.env} placeholder="API_KEY=…" onChange={(e) => setDraft({ ...draft, env: e.target.value })} />
            </label>
          </>
        ) : (
          <>
            <label className="field slim column">
              <span>Address</span>
              <input className="text plain mono" value={draft.url} placeholder="https://example.com/mcp" onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            </label>
            <label className="field slim column">
              <span>Headers <small className="muted">one Name: value per line, for example Authorization: Bearer …</small></span>
              <textarea className="plan-text mono" rows={3} value={draft.headers} onChange={(e) => setDraft({ ...draft, headers: e.target.value })} />
            </label>
          </>
        )}
        <label className="field slim column">
          <span>Longest wait for a tool <small className="muted">seconds. A server that reports progress gets the full time again each time, so slow work like a render is fine. Stopping the reply cancels the call</small></span>
          <input className="text plain" type="number" min={5} max={3600} value={draft.timeout} onChange={(e) => setDraft({ ...draft, timeout: e.target.value })} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          <span>Connect when Penumbra starts</span>
        </label>
        <p className="net-note warn"><ShieldAlert size={13} /> A program runs on this computer with your permissions, so add only servers you trust. Keys you type here are saved in this profile, unencrypted.</p>
        <div className="row gap">
          <button className="btn primary" disabled={!ready || busy || (!dirty && rt.status === 'on')} onClick={save}>{dirty ? 'Save and connect' : 'Reconnect'}</button>
          {dirty && <button className="btn" onClick={() => setDraft(toDraft(server))}>Undo changes</button>}
        </div>
      </section>

      {rt.status === 'on' && (
        <section className="panel">
          <h4>Tools <span className="muted small">· {rt.tools.length}</span></h4>
          {rt.info?.name && (
            <p className="muted small">
              {rt.info.name}{rt.info.version ? ` ${rt.info.version}` : ''}
              {rt.info.instructions && <> · <button className="link-btn small" onClick={() => setShowInfo(!showInfo)}>{showInfo ? 'Hide' : 'Show'} what it says about itself</button></>}
            </p>
          )}
          {showInfo && rt.info?.instructions && <pre className="source-text">{rt.info.instructions}</pre>}
          {rt.tools.length === 0 && <p className="muted small">This server has no tools.</p>}
          <div className="mcp-tools">
            {rt.tools.map((t) => {
              const allowed = server.allowed.includes(t.name);
              return (
                <div key={t.name} className="mcp-tool">
                  <div className="row gap">
                    <b className="mono small">{t.title || t.name}</b>
                    {t.readOnly && <span className="badge label" title="The server says this tool only reads">read-only</span>}
                    <span className="flex" />
                    <label className="check-row mcp-allow" title="Run this tool without asking each time">
                      <input type="checkbox" checked={allowed} onChange={(e) => updateServer(server.id, (s) => ({ allowed: e.target.checked ? [...s.allowed, t.name] : s.allowed.filter((x) => x !== t.name) }))} />
                      <span className="small">Always allow</span>
                    </label>
                  </div>
                  {t.description && <div className="muted small">{t.description.slice(0, 240)}{t.description.length > 240 ? '…' : ''}</div>}
                </div>
              );
            })}
          </div>
          <p className="muted small">
            <Check size={12} /> Chats and agents use these once <b>Connected apps</b> is on in the chat's tools panel, or in the agent's tools. <button className="link-btn small" onClick={onOpenAgents}>Open Agents</button>. By default every use asks you first.
          </p>
        </section>
      )}

      <section className="panel">
        <div className="row gap project-danger">
          {confirmDelete ? (
            <>
              <span className="muted small flex"><TriangleAlert size={12} /> Remove “{server.name}”? Penumbra disconnects and forgets it.</span>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn sm danger" onClick={async () => { await removeServer(server.id); onDeleted(); }}><X size={12} /> Remove</button>
            </>
          ) : (
            <button className="btn sm danger-text" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> Remove this server</button>
          )}
        </div>
      </section>
    </div>
  );
}

const toDraft = (s: McpServer) => ({
  name: s.name,
  transport: s.transport,
  line: joinCommand([s.command, ...s.args].filter((w) => w !== '')),
  env: pairsText(s.env, '='),
  url: s.url,
  headers: pairsText(s.headers, ':'),
  enabled: s.enabled,
  timeout: String(s.timeoutSec ?? DEFAULT_TIMEOUT),
});
