import { useState } from 'react';
import * as api from '../api';
import type { OllamaState } from '../store';
import { Check, Copy, Server } from '../components/icons';

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
          <p className="muted">Server connection and API usage.</p>
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
