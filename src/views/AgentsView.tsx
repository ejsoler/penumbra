import { useEffect, useRef, useState } from 'react';
import type { OllamaState } from '../store';
import { usePersistent } from '../store';
import {
  AGENT_TEMPLATES, createAgent, deleteAgent, duplicateAgent, PERSONA_LIMIT, TOOL_GROUPS, updateAgent, useAgents, type Agent, type ToolGroup,
} from '../agents/agents';
import { NEW_SKILL, refreshSkills, setSkillEnabled, useSkills } from '../agents/skills';
import { host, type SkillInfo } from '../host';
import { useContextMenu } from '../components/ContextMenu';
import { AgentAvatar, AvatarPicker, colorFor, initials, isImageAvatar } from '../components/AgentAvatar';
import {
  BookOpen, Bot, Copy, FileText, FolderOpen, Globe, MessageSquarePlus, Pencil, Plus, Sparkles, Terminal, Trash2, Upload, X,
} from '../components/icons';

type Tab = 'agents' | 'skills';
type Template = (typeof AGENT_TEMPLATES)[number];

/**
 * Installed models that can generate images: Ollama's "image" capability. A known image model name only
 * counts while its capabilities haven't loaded; a GGUF copy from Hugging Face reports "completion" and
 * can't generate images in Ollama.
 */
const imageModelsOf = (ollama: OllamaState) =>
  ollama.models
    .filter((m) => {
      if (m.remote_host) return false;
      const caps = ollama.capabilities[m.name];
      return caps ? caps.includes('image') : /^x\/(z-image|flux)/i.test(m.name);
    })
    .map((m) => m.name);

export function AgentsView({ ollama, onChatWithAgent }: { ollama: OllamaState; onChatWithAgent: (agentId: string) => void }) {
  const [tab, setTab] = usePersistent<Tab>('ollama-gui.agentsTab', 'agents');
  const [selected, setSelected] = useState<string | null>(null);
  const agents = useAgents();
  const { skills } = useSkills();
  // The New agent wizard: closed, blank, or started from a template.
  const [wizard, setWizard] = useState<{ template?: Template } | null>(null);

  // Keep a valid selection when the list changes.
  const ids = tab === 'agents' ? agents.map((a) => a.id) : skills.map((s) => s.id);
  // Agents open on the card grid; skills open on the first skill.
  const current = selected && (ids.includes(selected) || selected === 'new-skill') ? selected : tab === 'agents' ? null : ids[0] ?? null;

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
          <AgentList agents={agents} current={current} onSelect={setSelected} onNew={() => setWizard({})} />
        ) : (
          <SkillList skills={skills} current={current} onSelect={setSelected} />
        )}
      </aside>
      <main className="page agents-page">
        {tab === 'agents' ? (
          current ? (
            <AgentEditor key={current} agent={agents.find((a) => a.id === current)!} ollama={ollama} skills={skills} onChat={() => onChatWithAgent(current)} onBack={() => setSelected(null)} />
          ) : agents.length ? (
            <AgentCards agents={agents} ollama={ollama} onOpen={setSelected} onChat={onChatWithAgent} onNew={() => setWizard({})} />
          ) : (
            <AgentsEmpty onStart={(template) => setWizard({ template })} />
          )
        ) : current ? (
          <SkillEditor key={current} id={current === 'new-skill' ? null : current} onSaved={setSelected} />
        ) : (
          <SkillsEmpty onNew={() => setSelected('new-skill')} />
        )}
      </main>
      {wizard && (
        <NewAgentWizard
          template={wizard.template}
          ollama={ollama}
          agents={agents}
          onClose={() => setWizard(null)}
          onCreated={(id) => {
            setWizard(null);
            setTab('agents');
            setSelected(id);
          }}
        />
      )}
    </>
  );
}

// ---- agents ---------------------------------------------------------------------------------------

function AgentList({ agents, current, onSelect, onNew }: { agents: Agent[]; current: string | null; onSelect: (id: string) => void; onNew: () => void }) {
  const menu = useContextMenu();
  return (
    <div className="conv-list">
      <button className="btn sm list-new" onClick={onNew}><Plus size={13} /> New agent</button>
      {agents.length > 0 && (
        <div className={`conv-item all-agents ${current ? '' : 'active'}`} onClick={() => onSelect('')}>
          <span className="all-agents-icon"><Bot size={16} /></span>
          <div className="conv-text">
            <span className="conv-title">All agents</span>
            <span className="conv-sub">{agents.length} agent{agents.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      )}
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
          <AgentAvatar agent={a} size={34} />
          <div className="conv-text">
            <span className="conv-title">{a.name}</span>
            <span className="conv-sub">{a.model || 'No model'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const TOOL_ICONS: Record<ToolGroup, typeof Globe> = { skills: BookOpen, web: Globe, files: FileText, write: Pencil, terminal: Terminal };

/** The Agents page's overview: one trading card per agent. */
function AgentCards({ agents, ollama, onOpen, onChat, onNew }: { agents: Agent[]; ollama: OllamaState; onOpen: (id: string) => void; onChat: (id: string) => void; onNew: () => void }) {
  return (
    <div className="editor wide">
      <header className="page-head">
        <div>
          <h1>Agents</h1>
          <p className="muted">Each agent has its own purpose and persona, and shares the model’s full knowledge.</p>
        </div>
        <button className="btn primary" onClick={onNew}><Plus size={14} /> New agent</button>
      </header>
      <div className="tcards">
        {agents.map((a, i) => (
          <div key={a.id} className="tcard-wrap">
            <TradingCard agent={a} size={ollama.models.find((m) => m.name === a.model)?.details.parameter_size} number={`${i + 1}/${agents.length}`} onClick={() => onOpen(a.id)} />
            <div className="tcard-actions">
              <button className="btn sm" onClick={() => onOpen(a.id)}>Edit</button>
              <button className="btn primary sm" disabled={!a.model} title={a.model ? '' : 'Choose a model first'} onClick={() => onChat(a.id)}><MessageSquarePlus size={13} /> Chat</button>
            </div>
          </div>
        ))}
        <div className="tcard-wrap">
          <button className="tcard new" onClick={onNew}>
            <Plus size={26} />
            <span>New agent</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function TradingCard({ agent: a, size, number, onClick }: { agent: Agent; size?: string; number: string; onClick: () => void }) {
  const card = useRef<HTMLButtonElement>(null);
  // Tilts toward the pointer, with a light that follows it.
  const tilt = (e: React.MouseEvent) => {
    const el = card.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${(x - 0.5) * 14}deg`);
    el.style.setProperty('--ry', `${(0.5 - y) * 14}deg`);
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
  };
  const reset = () => {
    for (const p of ['--rx', '--ry', '--mx', '--my']) card.current?.style.removeProperty(p);
  };
  const label = (t: ToolGroup) => TOOL_GROUPS.find((g) => g.id === t)?.label ?? t;
  return (
    <button ref={card} className="tcard" style={{ '--c': colorFor(a.id) } as React.CSSProperties} onClick={onClick} onMouseMove={tilt} onMouseLeave={reset} title={`Open ${a.name}`}>
      <div className="tcard-inner">
        <div className="tcard-head">
          <b>{a.name}</b>
          {size && <span className="tcard-cost" title="Model size">{size}</span>}
        </div>
        <div className="tcard-art">
          {isImageAvatar(a.avatar) ? <img src={a.avatar} alt="" draggable={false} /> : <span className={a.avatar ? 'tcard-emoji' : 'tcard-initials'}>{a.avatar || initials(a.name)}</span>}
        </div>
        <div className="tcard-type">
          <span>Agent{a.createdBy === 'orchestrator' ? ' · made by the orchestrator' : ''}</span>
        </div>
        <div className="tcard-text">
          <p className="tcard-purpose">{a.description || 'No purpose yet.'}</p>
          <div className="tcard-abilities">
            {a.tools.map((t) => {
              const Icon = TOOL_ICONS[t] ?? Sparkles;
              return <span key={t} className="tcard-ability"><Icon size={11} /> {label(t)}</span>;
            })}
          </div>
          {a.persona && <p className="tcard-flavor">{a.persona}</p>}
        </div>
        <div className="tcard-foot">
          <span className="mono">{a.model || 'No model'}</span>
          <span>{number}</span>
        </div>
      </div>
      <span className="tcard-shine" aria-hidden="true" />
    </button>
  );
}

function AgentsEmpty({ onStart }: { onStart: (template?: Template) => void }) {
  return (
    <div className="agents-empty">
      <Bot size={36} className="accent" />
      <h2>Create your first agent</h2>
      <p className="muted">An agent has its own purpose, name, and persona. Every agent shares the model’s full knowledge; the persona shapes how it talks and works. Use one in any chat, or let the orchestrator assign it tasks.</p>
      <div className="template-grid">
        {AGENT_TEMPLATES.map((t) => (
          <button key={t.name} className="template" onClick={() => onStart(t)}>
            <b>{t.name}</b>
            <span className="muted small">{t.description}</span>
          </button>
        ))}
        <button className="template blank" onClick={() => onStart()}>
          <b><Plus size={13} /> Blank agent</b>
          <span className="muted small">Start from scratch</span>
        </button>
      </div>
    </div>
  );
}

function AgentEditor({ agent, ollama, skills, onChat, onBack }: { agent: Agent; ollama: OllamaState; skills: SkillInfo[]; onChat: () => void; onBack: () => void }) {
  const set = (patch: Partial<Agent>) => updateAgent(agent.id, patch);
  const chatModels = ollama.models.filter((m) => !(ollama.capabilities[m.name] ?? []).includes('embedding'));
  const caps = ollama.capabilities[agent.model] ?? [];
  const noTools = !!agent.model && caps.length > 0 && !caps.includes('tools');
  const toggleTool = (t: ToolGroup, on: boolean) => set({ tools: on ? [...new Set([...agent.tools, t])] : agent.tools.filter((x) => x !== t) });
  const allSkills = agent.skills.length === 0;

  return (
    <div className="editor">
      <button className="link-btn back-link" onClick={onBack}>← All agents</button>
      <header className="page-head">
        <AvatarPicker agent={agent} onChange={(avatar) => set({ avatar })} size={84} imageModels={imageModelsOf(ollama)} />
        <div className="editor-title">
          <input className="title-input" value={agent.name} onChange={(e) => set({ name: e.target.value })} aria-label="Agent name" />
          <input className="subtitle-input" value={agent.description} placeholder="Purpose: what is this agent for? (the orchestrator reads this)" onChange={(e) => set({ description: e.target.value })} aria-label="Purpose" />
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
        <h4>Persona</h4>
        <PersonaField value={agent.persona ?? ''} onChange={(persona) => set({ persona })} />
      </section>

      <section className="panel">
        <h4>Instructions <span className="muted small normal">optional</span></h4>
        <textarea
          className="instructions"
          rows={5}
          value={agent.instructions}
          placeholder="Extra rules on top of the persona: formats to follow, steps to always take, things to avoid."
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

const PERSONA_IDEAS = [
  'Friendly and encouraging; explains simply and celebrates progress.',
  'Direct and concise; leads with the answer, no filler.',
  'Patient teacher; asks a question before explaining, and checks understanding.',
  'Playful and creative; offers bold ideas and fresh angles.',
];

/** A short persona with a soft length limit and a few ideas to start from. */
function PersonaField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const long = value.length > PERSONA_LIMIT;
  return (
    <div className="persona-field">
      <textarea
        className="instructions"
        rows={3}
        value={value}
        autoFocus={autoFocus}
        placeholder="Personality, communication style, and approach, in a sentence or two. For example: Calm and thorough. Explains the why, not just the how, and flags risks early."
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="persona-foot">
        <div className="persona-ideas">
          {PERSONA_IDEAS.map((idea) => (
            <button key={idea} type="button" className="chip" title={idea} onClick={() => onChange(idea)}>{idea.split(';')[0]}</button>
          ))}
        </div>
        <span className={`small ${long ? 'amber' : 'muted'}`} title="Personas work best short">{value.length}/{PERSONA_LIMIT}</span>
      </div>
      <p className="hint muted">{long ? 'Shorter works better: a persona sets the tone, it isn’t a full prompt. Put detailed rules in Instructions.' : 'It changes how the agent talks and works, not what it knows.'}</p>
    </div>
  );
}

function NewAgentWizard({ template, ollama, agents, onClose, onCreated }: {
  template?: Template;
  ollama: OllamaState;
  agents: Agent[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [purpose, setPurpose] = useState(template?.description ?? '');
  const [name, setName] = useState(template?.name ?? '');
  const [persona, setPersona] = useState(template?.persona ?? '');
  const [avatar, setAvatar] = useState<string | undefined>();
  const [draftId] = useState(() => `draft-${Date.now()}`);
  const chatModels = ollama.models
    .filter((m) => !(ollama.capabilities[m.name] ?? []).includes('embedding'))
    .sort((a, b) => Number(!!a.remote_host) - Number(!!b.remote_host));
  // The model the newest agent uses, or the first local one.
  const lastModel = [...agents].sort((a, b) => b.createdAt - a.createdAt).find((a) => chatModels.some((m) => m.name === a.model))?.model;
  const [model, setModel] = useState(lastModel ?? chatModels[0]?.name ?? '');
  const taken = agents.some((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase());
  const ready = purpose.trim() && name.trim() && !taken;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = () => {
    if (!ready) return;
    const a = createAgent({
      name: name.trim(),
      description: purpose.trim(),
      persona: persona.trim() || undefined,
      avatar,
      model,
      instructions: template?.instructions ?? '',
      tools: template?.tools ?? ['skills'],
    });
    onCreated(a.id);
  };
  const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), create());

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wizard" role="dialog" aria-label="New agent">
        <div className="wizard-head">
          <h3><Sparkles size={16} className="accent" /> {template ? `New agent from ${template.name}` : 'New agent'}</h3>
          <button className="icon-btn sm" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="wizard-intro">
          <AvatarPicker agent={{ id: draftId, name: name || '?', avatar, description: purpose, persona }} onChange={setAvatar} size={52} imageModels={imageModelsOf(ollama)} />
          <p>Every agent shares the model’s knowledge. Give this one a purpose, a name, and a persona, and an avatar if you like.</p>
        </div>

        <label className="wizard-field">
          <span>Purpose</span>
          <input className="text plain" value={purpose} autoFocus placeholder="What is it for? e.g. Helps me plan healthy weekly meals" onChange={(e) => setPurpose(e.target.value)} onKeyDown={enter} />
        </label>
        <label className="wizard-field">
          <span>Agent name</span>
          <input className="text plain" value={name} placeholder="e.g. Chef Ana" onChange={(e) => setName(e.target.value)} onKeyDown={enter} />
          {taken && <small className="amber">An agent with this name already exists.</small>}
        </label>
        <div className="wizard-field">
          <span>Persona <small className="muted">optional</small></span>
          <PersonaField value={persona} onChange={setPersona} />
        </div>
        <label className="wizard-field">
          <span>Model</span>
          <select className="wide-select" value={model} onChange={(e) => setModel(e.target.value)}>
            {!chatModels.length && <option value="">No models installed</option>}
            {chatModels.map((m) => <option key={m.name} value={m.name}>{m.name}{m.details.parameter_size ? ` (${m.details.parameter_size})` : ''}{m.remote_host ? ' · cloud' : ''}</option>)}
          </select>
        </label>

        <div className="modal-actions">
          <span className="muted small flex">{template ? `Tools: ${(template.tools ?? []).join(', ')}. ` : ''}Tools, skills, and instructions can be changed after.</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!ready} onClick={create}>Create agent</button>
        </div>
      </div>
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
