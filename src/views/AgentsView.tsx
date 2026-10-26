import { useEffect, useState } from 'react';
import type { OllamaState } from '../store';
import { usePersistent } from '../store';
import {
  AGENT_TEMPLATES, createAgent, deleteAgent, duplicateAgent, TOOL_GROUPS, updateAgent, useAgents, type Agent, type ToolGroup,
} from '../agents/agents';
import { NEW_SKILL, refreshSkills, setSkillEnabled, useSkills } from '../agents/skills';
import { host, type SkillInfo } from '../host';
import { useContextMenu } from '../components/ContextMenu';
import {
  BookOpen, Bot, Copy, FolderOpen, MessageSquarePlus, Plus, Trash2, Upload, X,
} from '../components/icons';

type Tab = 'agents' | 'skills';

export function AgentsView({ ollama, onChatWithAgent }: { ollama: OllamaState; onChatWithAgent: (agentId: string) => void }) {
  const [tab, setTab] = usePersistent<Tab>('ollama-gui.agentsTab', 'agents');
  const [selected, setSelected] = useState<string | null>(null);
  const agents = useAgents();
  const { skills } = useSkills();

  // Keep a valid selection when the list changes.
  const ids = tab === 'agents' ? agents.map((a) => a.id) : skills.map((s) => s.id);
  const current = selected && (ids.includes(selected) || selected === 'new-skill') ? selected : ids[0] ?? null;

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="seg">
            <button className={tab === 'agents' ? 'on' : ''} onClick={() => { setTab('agents'); setSelected(null); }}><Bot size={13} /> Agents</button>
            <button className={tab === 'skills' ? 'on' : ''} onClick={() => { setTab('skills'); setSelected(null); }}><BookOpen size={13} /> Skills</button>
          </div>
        </div>
        {tab === 'agents' ? (
          <AgentList agents={agents} current={current} onSelect={setSelected} />
        ) : (
          <SkillList skills={skills} current={current} onSelect={setSelected} />
        )}
      </aside>
      <main className="page agents-page">
        {tab === 'agents' ? (
          current ? (
            <AgentEditor key={current} agent={agents.find((a) => a.id === current)!} ollama={ollama} skills={skills} onChat={() => onChatWithAgent(current)} />
          ) : (
            <AgentsEmpty onCreate={(id) => setSelected(id)} />
          )
        ) : current ? (
          <SkillEditor key={current} id={current === 'new-skill' ? null : current} onSaved={setSelected} />
        ) : (
          <SkillsEmpty onNew={() => setSelected('new-skill')} />
        )}
      </main>
    </>
  );
}

// ---- agents ---------------------------------------------------------------------------------------

function AgentList({ agents, current, onSelect }: { agents: Agent[]; current: string | null; onSelect: (id: string) => void }) {
  const menu = useContextMenu();
  return (
    <div className="conv-list">
      <button className="btn sm list-new" onClick={() => onSelect(createAgent().id)}><Plus size={13} /> New agent</button>
      {agents.map((a) => (
        <div
          key={a.id}
          className={`conv-item ${a.id === current ? 'active' : ''}`}
          onClick={() => onSelect(a.id)}
          onContextMenu={(e) =>
            menu(e, [
              { label: 'Duplicate', icon: Copy, onClick: () => onSelect(duplicateAgent(a).id) },
              'separator',
              { label: 'Delete agent', icon: Trash2, danger: true, onClick: () => confirm(`Delete the agent "${a.name}"?`) && deleteAgent(a.id) },
            ])
          }
        >
          <div className="conv-text">
            <span className="conv-title">{a.name}</span>
            <span className="conv-sub">{a.model || 'No model'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentsEmpty({ onCreate }: { onCreate: (id: string) => void }) {
  return (
    <div className="agents-empty">
      <Bot size={36} className="accent" />
      <h2>Create your first agent</h2>
      <p className="muted">An agent is a model with its own instructions and skills. Use one in any chat, or let the orchestrator assign it tasks.</p>
      <div className="template-grid">
        {AGENT_TEMPLATES.map((t) => (
          <button key={t.name} className="template" onClick={() => onCreate(createAgent(t).id)}>
            <b>{t.name}</b>
            <span className="muted small">{t.description}</span>
          </button>
        ))}
        <button className="template blank" onClick={() => onCreate(createAgent().id)}>
          <b><Plus size={13} /> Blank agent</b>
          <span className="muted small">Start from scratch</span>
        </button>
      </div>
    </div>
  );
}

function AgentEditor({ agent, ollama, skills, onChat }: { agent: Agent; ollama: OllamaState; skills: SkillInfo[]; onChat: () => void }) {
  const set = (patch: Partial<Agent>) => updateAgent(agent.id, patch);
  const chatModels = ollama.models.filter((m) => !(ollama.capabilities[m.name] ?? []).includes('embedding'));
  const caps = ollama.capabilities[agent.model] ?? [];
  const noTools = !!agent.model && caps.length > 0 && !caps.includes('tools');
  const toggleTool = (t: ToolGroup, on: boolean) => set({ tools: on ? [...new Set([...agent.tools, t])] : agent.tools.filter((x) => x !== t) });
  const allSkills = agent.skills.length === 0;

  return (
    <div className="editor">
      <header className="page-head">
        <div className="editor-title">
          <input className="title-input" value={agent.name} onChange={(e) => set({ name: e.target.value })} aria-label="Agent name" />
          <input className="subtitle-input" value={agent.description} placeholder="What is this agent for? (the orchestrator reads this)" onChange={(e) => set({ description: e.target.value })} />
        </div>
        <button className="btn primary" disabled={!agent.model} onClick={onChat}><MessageSquarePlus size={14} /> Chat with agent</button>
      </header>

      <section className="panel">
        <h4>Model</h4>
        <select className="wide-select" value={agent.model} onChange={(e) => set({ model: e.target.value })}>
          <option value="">Choose a model…</option>
          {chatModels.map((m) => (
            <option key={m.name} value={m.name}>{m.name}{m.details.parameter_size ? ` (${m.details.parameter_size})` : ''}</option>
          ))}
          {agent.model && !chatModels.some((m) => m.name === agent.model) && <option value={agent.model}>{agent.model} (not installed)</option>}
        </select>
        {noTools && <p className="hint warn">This model can't call tools, so it can't use skills. Pick a model with the "tools" capability.</p>}
        <label className="field slim">
          <span>Temperature <small className="muted">blank = chat setting</small></span>
          <input
            className="num wide"
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={agent.temperature ?? ''}
            onChange={(e) => set({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="panel">
        <h4>Instructions</h4>
        <textarea
          className="instructions"
          rows={8}
          value={agent.instructions}
          placeholder="How should this agent behave? What is it good at? What should it avoid?"
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </section>

      <section className="panel">
        <h4>Tools</h4>
        {TOOL_GROUPS.map((t) => (
          <label key={t.id} className="check-row">
            <input type="checkbox" checked={agent.tools.includes(t.id)} onChange={(e) => toggleTool(t.id, e.target.checked)} />
            <span><b>{t.label}</b> <span className="muted small">{t.description}</span></span>
          </label>
        ))}
        <p className="hint muted">Interactive widgets follow each chat's Interactive switch.</p>
      </section>

      {agent.tools.includes('skills') && (
        <section className="panel">
          <h4>Skills</h4>
          {!skills.length ? (
            <p className="muted small">No skills yet. Create or import them in the Skills tab.</p>
          ) : (
            <>
              <label className="check-row">
                <input type="radio" checked={allSkills} onChange={() => set({ skills: [] })} />
                <span><b>All enabled skills</b></span>
              </label>
              <label className="check-row">
                <input type="radio" checked={!allSkills} onChange={() => set({ skills: skills.slice(0, 1).map((s) => s.id) })} />
                <span><b>Only these:</b></span>
              </label>
              {!allSkills && (
                <div className="indent">
                  {skills.map((s) => (
                    <label key={s.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={agent.skills.includes(s.id)}
                        onChange={(e) => {
                          const next = e.target.checked ? [...agent.skills, s.id] : agent.skills.filter((x) => x !== s.id);
                          set({ skills: next.length ? next : agent.skills });
                        }}
                      />
                      <span><b>{s.name}</b> <span className="muted small">{s.description}</span></span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ---- skills ---------------------------------------------------------------------------------------

function SkillList({ skills, current, onSelect }: { skills: SkillInfo[]; current: string | null; onSelect: (id: string) => void }) {
  const { disabled, available } = useSkills();
  const [error, setError] = useState('');
  const menu = useContextMenu();
  const doImport = async () => {
    setError('');
    try {
      const ids = await host()!.skills.import();
      await refreshSkills();
      if (ids.length) onSelect(ids[0]);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };
  if (!available) return <p className="muted small pad">Skills are stored on disk, so they need the desktop app.</p>;
  return (
    <div className="conv-list">
      <div className="row gap list-new">
        <button className="btn sm flex" onClick={() => onSelect('new-skill')}><Plus size={13} /> New</button>
        <button className="btn sm flex" onClick={doImport}><Upload size={13} /> Import…</button>
      </div>
      {error && <div className="banner error small">{error}<button className="icon-btn sm" onClick={() => setError('')}><X size={12} /></button></div>}
      {skills.map((s) => (
        <div
          key={s.id}
          className={`conv-item ${s.id === current ? 'active' : ''} ${disabled.includes(s.id) ? 'dim' : ''}`}
          onClick={() => onSelect(s.id)}
          onContextMenu={(e) =>
            menu(e, [
              { label: 'Show in folder', icon: FolderOpen, onClick: () => host()?.skills.reveal(s.id) },
              'separator',
              { label: 'Move to Trash', icon: Trash2, danger: true, onClick: async () => { await host()?.skills.remove(s.id); refreshSkills(); } },
            ])
          }
        >
          <div className="conv-text">
            <span className="conv-title">{s.name}</span>
            <span className="conv-sub">{disabled.includes(s.id) ? 'Off' : s.description || 'No description'}</span>
          </div>
        </div>
      ))}
      <button className="btn sm ghost list-new" onClick={() => host()?.skills.reveal()}><FolderOpen size={13} /> Open skills folder</button>
    </div>
  );
}

function SkillsEmpty({ onNew }: { onNew: () => void }) {
  const { available } = useSkills();
  return (
    <div className="agents-empty">
      <BookOpen size={36} className="accent" />
      <h2>Skills</h2>
      <p className="muted">
        A skill teaches the model how to do one kind of task: a writing style, a report format, a checklist, a workflow. It's a folder with a
        SKILL.md file, the same format Claude uses, so you can import existing skills.
      </p>
      <p className="muted small">The model only sees each skill's name and description, and loads the full instructions when a task needs them.</p>
      {available && <button className="btn primary" onClick={onNew}><Plus size={14} /> New skill</button>}
    </div>
  );
}

function SkillEditor({ id, onSaved }: { id: string | null; onSaved: (id: string) => void }) {
  const { skills, disabled } = useSkills();
  const info = skills.find((s) => s.id === id);
  const [text, setText] = useState<string | null>(id ? null : NEW_SKILL);
  const [saved, setSaved] = useState(id ? '' : NEW_SKILL);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ file: string; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    host()!.skills.read(id).then((t) => { setText(t); setSaved(t); }, (e) => setError(e.message));
  }, [id]);

  const save = async () => {
    setError('');
    try {
      const newId = await host()!.skills.save(id, text ?? '');
      setSaved(text ?? '');
      await refreshSkills();
      if (newId !== id) onSaved(newId);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };
  const dirty = text !== null && text !== saved;

  return (
    <div className="editor">
      <header className="page-head">
        <div>
          <h1>{info?.name ?? 'New skill'}</h1>
          <p className="muted">{id ? <span className="mono small">skills/{id}/SKILL.md</span> : 'Write the SKILL.md, then save to create the folder.'}</p>
        </div>
        <div className="row gap">
          {info && (
            <label className="check-row inline" title="Off hides this skill from every chat and agent">
              <input type="checkbox" checked={!disabled.includes(info.id)} onChange={(e) => setSkillEnabled(info.id, e.target.checked)} />
              <span>Enabled</span>
            </label>
          )}
          <button className="btn primary" disabled={!dirty} onClick={save}>{id ? 'Save' : 'Create skill'}</button>
        </div>
      </header>
      {error && <div className="banner error">{error}</div>}
      <section className="panel">
        <h4>SKILL.md</h4>
        <p className="hint muted">
          The <code>name</code> and <code>description</code> at the top are what the model sees before loading the skill, so describe <i>when</i> to use it.
        </p>
        <textarea className="skill-text mono" spellCheck={false} value={text ?? 'Loading…'} onChange={(e) => setText(e.target.value)} disabled={text === null} />
      </section>
      {info && (
        <section className="panel">
          <h4>Reference files</h4>
          {info.files.length ? (
            <ul className="file-list">
              {info.files.map((f) => (
                <li key={f}>
                  <button className="link-btn mono" onClick={async () => setPreview({ file: f, text: await host()!.skills.readFile(info.id, f).catch((e) => `Can't open: ${e.message}`) })}>{f}</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None. Add files (templates, examples, data) to the skill's folder and mention them in SKILL.md.</p>
          )}
          <button className="btn sm" onClick={() => host()?.skills.reveal(info.id)}><FolderOpen size={13} /> Show in folder</button>
          {preview && (
            <div className="file-preview">
              <div className="row"><b className="mono small flex">{preview.file}</b><button className="icon-btn sm" onClick={() => setPreview(null)}><X size={12} /></button></div>
              <pre>{preview.text}</pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
