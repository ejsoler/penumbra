import { useState } from 'react';
import * as api from '../api';
import type { OllamaState } from '../store';
import { Check, Copy, Loader2, Play, RefreshCw, Server } from '../components/icons';
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
          <p className="muted">Server connection, API usage, the guided demo, and updates.</p>
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

      {penumbraHost() && <DemoPanel ollama={ollama} />}

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

function DemoPanel({ ollama }: { ollama: OllamaState }) {
  // Local models that can call tools: the tour uses agents and tools. Loaded ones first, so it starts fast.
  const models = ollama.models
    .filter((m) => !m.remote_host && (ollama.capabilities[m.name] ?? []).includes('tools') && !(ollama.capabilities[m.name] ?? []).includes('embedding'))
    .sort((a, b) => Number(ollama.running.some((r) => r.name === b.name)) - Number(ollama.running.some((r) => r.name === a.name)));
  const [choice, setChoice] = useState('');
  const [state, setState] = useState<'idle' | 'starting' | 'open' | string>('idle');
  const model = models.some((m) => m.name === choice) ? choice : models[0]?.name ?? '';
  const start = async () => {
    setState('starting');
    try {
      await penumbraHost()!.startDemo(model);
      setState('open');
    } catch (e) {
      setState(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
  };
  return (
    <section className="panel">
      <h4>Guided demo</h4>
      <p className="muted small">
        A step-by-step tour of Penumbra: interactive answers, internet widgets, agents and skills, tools, the orchestrator, and the scheduler. It opens in its own
        window with demo chats, agents, and files, so yours aren’t touched. A panel shows each step; nothing happens until you click Next.
      </p>
      <div className="row gap" style={{ alignItems: 'center', marginTop: 10 }}>
        <select className="wide-select" value={model} onChange={(e) => setChoice(e.target.value)} disabled={!models.length}>
          {!models.length && <option value="">No local model with tool support installed</option>}
          {models.map((m) => <option key={m.name} value={m.name}>{m.name}{m.details.parameter_size ? ` (${m.details.parameter_size})` : ''}</option>)}
        </select>
        <button className="btn primary" disabled={!model || state === 'starting'} onClick={start}>
          {state === 'starting' ? <Loader2 size={14} className="spin" /> : <Play size={14} />} {state === 'open' ? 'Show demo' : 'Start demo'}
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        {state !== 'idle' && state !== 'starting' && state !== 'open' ? <span className="red">{state}</span> : 'Every reply uses this model. A model of about 7B or larger works best; the full tour takes about 25 minutes.'}
      </p>
    </section>
  );
}
