import { useState } from 'react';
import * as api from '../api';
import type { OllamaState } from '../store';
import { Check, Copy, Loader2, RefreshCw, Server } from '../components/icons';
import { host as penumbraHost } from '../host';
import { checkForUpdates, setUpdateSettings, useUpdates } from '../updates';

export function DeveloperView({ ollama }: { ollama: OllamaState }) {
  const [host, setHostInput] = useState(api.getHost());
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState('');
  const model = ollama.running[0]?.name ?? ollama.models[0]?.name ?? 'llama3.2';

  const save = () => {
    api.setHost(host.trim() || api.DEFAULT_HOST);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    ollama.refresh();
  };

  const snippets: Record<string, string> = {
    'cURL': `curl ${api.getHost()}/api/chat -d '{
  "model": "${model}",
  "messages": [{ "role": "user", "content": "Hello!" }]
}'`,
    'OpenAI-compatible': `curl ${api.getHost()}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{ "role": "user", "content": "Hello!" }]
  }'`,
    'Python': `from ollama import chat

response = chat(model="${model}", messages=[
    {"role": "user", "content": "Hello!"},
])
print(response.message.content)`,
  };

  const copy = (k: string) => {
    navigator.clipboard.writeText(snippets[k]);
    setCopied(k);
    setTimeout(() => setCopied(''), 1500);
  };

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Developer</h1>
          <p className="muted">Server connection, API usage, and updates.</p>
        </div>
      </header>

      <section className="panel">
        <div className="server-status">
          <Server size={18} />
          <span className={`dot ${ollama.connected ? 'on' : 'off'}`} />
          <span className="strong">{ollama.connected ? 'Ollama is running' : ollama.connected === false ? 'Cannot reach Ollama' : 'Connecting…'}</span>
          {ollama.version && <span className="muted mono">v{ollama.version}</span>}
        </div>
        <label className="field column">
          <span>Server URL</span>
          <div className="row gap">
            <input className="text" value={host} onChange={(e) => setHostInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <button className="btn primary" onClick={save}>{saved ? <Check size={14} /> : 'Save'}</button>
          </div>
        </label>
        {ollama.connected === false && (
          <p className="muted small">
            Make sure Ollama is running (<code>ollama serve</code>). If it's on another machine or origin, start it with{' '}
            <code>OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=*</code>.
          </p>
        )}
      </section>

      {penumbraHost() && <UpdatesPanel />}

      <section className="panel">
        <h4>Quick start</h4>
        {Object.entries(snippets).map(([k, v]) => (
          <div key={k} className="snippet">
            <div className="codeblock-head">
              <span>{k}</span>
              <button className="icon-btn sm" onClick={() => copy(k)}>{copied === k ? <Check size={13} /> : <Copy size={13} />}</button>
            </div>
            <pre>{v}</pre>
          </div>
        ))}
      </section>
    </main>
  );
}

function UpdatesPanel() {
  const u = useUpdates();
  const { info, settings } = u;
  const status = u.checking
    ? 'Checking…'
    : u.error
      ? `Couldn't check: ${u.error}`
      : !info
        ? 'Not checked yet.'
        : info.available
          ? settings.skipped === info.version
            ? `Penumbra ${info.version} is available. You chose to skip it.`
            : `Penumbra ${info.version} is available. Open it from the arrow icon in the sidebar.`
          : "You're up to date.";
  return (
    <section className="panel">
      <h4>Updates</h4>
      <div className="row gap" style={{ alignItems: 'center' }}>
        <span className="muted">Penumbra <span className="mono">{info?.current ?? '…'}</span></span>
        <span className="flex" />
        <button className="btn sm" onClick={checkForUpdates} disabled={u.checking}>
          {u.checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Check now
        </button>
      </div>
      <p className="muted small">{status}</p>
      {info?.available && settings.skipped === info.version && (
        <button className="link small" style={{ marginLeft: 0 }} onClick={() => setUpdateSettings({ skipped: '' })}>Show it in the sidebar again</button>
      )}
      <label className="check-row">
        <input type="checkbox" checked={settings.auto} onChange={(e) => setUpdateSettings({ auto: e.target.checked })} />
        <span>Check for updates automatically <span className="muted">(asks GitHub for the latest release; nothing else is sent)</span></span>
      </label>
    </section>
  );
}
