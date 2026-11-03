// Home: where Penumbra opens. A quick way to start a chat, and a card for each tab showing what's going on
// there (recent chats, agents, scheduled tasks, orchestrator runs, models and downloads, images, and the
// app itself), each with a way to jump in.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAgents } from '../agents/agents';
import { AgentAvatar } from '../components/AgentAvatar';
import { openLightbox } from '../components/Lightbox';
import { Logo } from '../components/Logo';
import { openTutorial } from '../components/Tutorial';
import {
  ArrowUp, ArrowUpCircle, Bot, CalendarClock, ChevronRight, CircleAlert, CircleCheck, DatabaseBackup, Download, FolderOpen, ImageIcon, Loader2,
  BookOpen, MessageSquare, Workflow,
} from '../components/icons';
import type { Downloads } from '../downloads';
import { host, type BackupImage } from '../host';
import { imageUrl, readyModels, useImages } from '../images';
import { lastBackup } from '../backup';
import { useProfile } from '../profile';
import { describeWhen, useScheduler } from '../scheduler';
import { chatController, streaming, useConversations } from '../session';
import type { OllamaState } from '../store';
import { updateWaiting, useUpdates } from '../updates';

const ORCHESTRATOR_ID = 'orchestrator';
const gb = (n: number) => `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;

/** "just now", "5 min ago", "yesterday", "3 days ago", or a date. */
function ago(t: number, now = Date.now()) {
  const s = (now - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

/** One dashboard card: an icon, a title, a link to its tab, and what's in it. */
function Card({ icon, title, action, onOpen, children, className = '' }: {
  icon: ReactNode;
  title: string;
  action?: string;
  onOpen: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`home-card ${className}`}>
      <header className="home-card-head">
        <span className="home-card-icon">{icon}</span>
        <h3>{title}</h3>
        <button className="link-btn small home-open" onClick={onOpen}>{action ?? 'Open'} <ChevronRight size={13} /></button>
      </header>
      <div className="home-card-body">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="muted small home-empty">{children}</p>;

export function HomeView({ ollama, dl, setView, onChatWithAgent }: {
  ollama: OllamaState;
  dl: Downloads;
  setView: (view: string) => void;
  onChatWithAgent: (agentId: string) => void;
}) {
  const profile = useProfile();
  const agents = useAgents();
  const [conversations] = useConversations(() => ({ id: 'x', title: 'New Chat', model: '', systemPrompt: '', messages: [], updatedAt: Date.now() }));
  const scheduler = useScheduler();
  const images = useImages();
  const updates = useUpdates();
  const replying = streaming.use();
  const [prompt, setPrompt] = useState('');
  const [startError, setStartError] = useState('');
  const [files, setFiles] = useState<{ images: BackupImage[]; skills: number } | null>(null);

  useEffect(() => {
    host()?.backup.summary().then((s) => setFiles({ images: s.images, skills: s.skills.length })).catch(() => {});
  }, []);

  const chats = useMemo(() => conversations.filter((c) => c.messages.length && c.agentId !== ORCHESTRATOR_ID).sort((a, b) => b.updatedAt - a.updatedAt), [conversations]);
  const runs = useMemo(() => {
    const list: { convId: string; msgId: string; goal: string; phase: string; at: number }[] = [];
    for (const c of conversations) for (const m of c.messages) if (m.orchestration) list.push({ convId: c.id, msgId: m.id, goal: m.orchestration.goal, phase: m.orchestration.phase, at: c.updatedAt });
    return list.sort((a, b) => b.at - a.at);
  }, [conversations]);
  const nextTasks = scheduler.tasks.filter((t) => t.enabled && t.nextRun).sort((a, b) => a.nextRun! - b.nextRun!);
  const downloads = Object.values(dl.downloads).filter((d) => d.state === 'downloading' || d.state === 'paused');
  const imageModels = readyModels(images.status);
  const backedUp = lastBackup();

  const openChat = (id: string) => {
    chatController.current?.openChat(id);
    setView('chat');
  };
  /** The Orchestrator page shows the run it last had open. */
  const openRun = (msgId: string) => {
    try {
      localStorage.setItem('ollama-gui.workspaceRun', JSON.stringify(msgId));
    } catch {
      /* storage unavailable */
    }
    setView('orchestrator');
  };
  const start = () => {
    setStartError('');
    if (!prompt.trim()) return;
    const id = chatController.current?.startChat(prompt);
    if (id) {
      setPrompt('');
      setView('chat');
    } else setStartError(replying ? 'A reply is still being written. Try again when it finishes.' : 'Pick a model in the Chat tab first.');
  };

  return (
    <main className="page home-page">
      <header className="home-hero">
        <Logo size={40} />
        <div className="home-hero-text">
          <h1>{greeting(profile.name.trim())}</h1>
          <p className="muted">
            <span className={`home-dot ${ollama.connected ? 'on' : ollama.connected === false ? 'off' : ''}`} />
            {ollama.connected ? `Ollama ${ollama.version} · ${ollama.models.length} models installed` : ollama.connected === false ? "Can't reach Ollama. Is it running?" : 'Connecting to Ollama…'}
          </p>
        </div>
      </header>

      <form className="home-ask" onSubmit={(e) => { e.preventDefault(); start(); }}>
        <input value={prompt} onChange={(e) => { setPrompt(e.target.value); setStartError(''); }} placeholder="Ask anything to start a new chat…" aria-label="Start a new chat" />
        <button className="send-btn" disabled={!prompt.trim()} title="Start chat"><ArrowUp size={16} /></button>
      </form>
      {startError && <p className="small red home-ask-error">{startError}</p>}

      <div className="home-grid">
        <Card icon={<MessageSquare size={16} />} title="Recent chats" onOpen={() => setView('chat')} action="All chats">
          {chats.length ? (
            <ul className="home-list">
              {chats.slice(0, 5).map((c) => {
                const agent = agents.find((a) => a.id === c.agentId);
                return (
                  <li key={c.id}>
                    <button onClick={() => openChat(c.id)}>
                      {agent ? <AgentAvatar agent={agent} size={22} /> : <MessageSquare size={14} className="muted" />}
                      <span className="home-item-title">{c.title}</span>
                      {replying === c.id ? <Loader2 size={12} className="spin" /> : <span className="muted small">{ago(c.updatedAt)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <Empty>No chats yet. Ask something above to start one.</Empty>}
        </Card>

        <Card icon={<Bot size={16} />} title="Agents" onOpen={() => setView('agents')} action="Agents & Skills">
          {agents.length ? (
            <div className="home-agents">
              {agents.slice(0, 8).map((a) => (
                <button key={a.id} className="home-agent" disabled={!a.model} title={a.model ? `Chat with ${a.name}` : `${a.name} has no model yet`} onClick={() => onChatWithAgent(a.id)}>
                  <AgentAvatar agent={a} size={44} />
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          ) : <Empty>No agents yet. Make one with a purpose and a persona.</Empty>}
          <p className="muted small home-foot">{agents.length} {agents.length === 1 ? 'agent' : 'agents'}{files ? ` · ${files.skills} ${files.skills === 1 ? 'skill' : 'skills'}` : ''}</p>
        </Card>

        <Card icon={<CalendarClock size={16} />} title="Scheduled tasks" onOpen={() => setView('scheduler')} action="Scheduler">
          {scheduler.running && <p className="small home-running"><Loader2 size={12} className="spin" /> {scheduler.tasks.find((t) => t.id === scheduler.running)?.name ?? 'A task'} is running</p>}
          {nextTasks.length ? (
            <ul className="home-list">
              {nextTasks.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <button onClick={() => setView('scheduler')}>
                    {t.lastStatus === 'error' ? <CircleAlert size={14} className="red" /> : <CircleCheck size={14} className="muted" />}
                    <span className="home-item-title">{t.name}</span>
                    <span className="muted small">{describeWhen(t.nextRun!)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty>{scheduler.tasks.length ? 'No tasks are on right now.' : 'No scheduled tasks. Run prompts, agents, or commands on a schedule.'}</Empty>}
        </Card>

        <Card icon={<Workflow size={16} />} title="Orchestrator" onOpen={() => setView('orchestrator')} action="New run">
          {runs.length ? (
            <ul className="home-list">
              {runs.slice(0, 4).map((r) => (
                <li key={r.msgId}>
                  <button onClick={() => openRun(r.msgId)}>
                    <Workflow size={14} className="muted" />
                    <span className="home-item-title">{r.goal}</span>
                    <span className={`home-phase ${r.phase}`}>{r.phase === 'done' ? 'done' : r.phase === 'review' ? 'to review' : r.phase}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty>No runs yet. Give it a goal and it plans the work across your agents.</Empty>}
        </Card>

        <Card icon={<FolderOpen size={16} />} title="Models" onOpen={() => setView('models')} action="My Models">
          {ollama.running.length ? (
            <ul className="home-list static">
              {ollama.running.map((m) => (
                <li key={m.name}>
                  <span className="home-live" />
                  <span className="home-item-title mono">{m.name}</span>
                  <span className="muted small">{gb(m.size_vram || m.size)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No model is loaded right now. Picking one in a chat loads it.</Empty>}
          {downloads.length > 0 && (
            <div className="home-downloads">
              {downloads.slice(0, 3).map((d) => (
                <button key={d.name} className="home-download" onClick={() => setView('discover')}>
                  <span className="row gap"><Download size={12} /> <span className="home-item-title mono">{d.name}</span> <span className="muted small">{d.state === 'paused' ? 'paused' : d.total ? `${Math.round((d.completed / d.total) * 100)}%` : '…'}</span></span>
                  <span className="progress"><span style={{ width: `${d.total ? (d.completed / d.total) * 100 : 0}%` }} /></span>
                </button>
              ))}
            </div>
          )}
          <p className="muted small home-foot">
            {ollama.models.filter((m) => !m.remote_host).length} installed · <button className="link-btn small" onClick={() => setView('discover')}>Find more</button>
          </p>
        </Card>

        <Card icon={<ImageIcon size={16} />} title="Images" onOpen={() => setView('images')} action="Images">
          {files?.images.length ? (
            <div className="home-thumbs">
              {files.images.slice(0, 8).map((h, i) => (
                <button key={h.file} onClick={() => openLightbox(files.images.slice(0, 8).map((x) => ({ src: imageUrl(x.file), caption: x.prompt })), i)} title={h.prompt}>
                  <img src={imageUrl(h.file)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          ) : <Empty>{imageModels.length ? 'No images yet. Make one in the Images tab or ask for one in a chat.' : 'Make pictures on this computer: download an image model in the Images tab.'}</Empty>}
          <p className="muted small home-foot">{imageModels.length} image {imageModels.length === 1 ? 'model' : 'models'}{files ? ` · ${files.images.length} ${files.images.length === 1 ? 'image' : 'images'}` : ''}</p>
        </Card>

        <Card icon={<DatabaseBackup size={16} />} title="Backup" onOpen={() => setView('backup')} action="Back up">
          <p className="small home-stat">
            {backedUp ? <><CircleCheck size={14} className="green" /> Last backup {ago(backedUp)}</> : <><CircleAlert size={14} className="amber" /> No backup yet from this profile</>}
          </p>
          <p className="muted small">{chats.length} {chats.length === 1 ? 'chat' : 'chats'}, {agents.length} {agents.length === 1 ? 'agent' : 'agents'}, and {scheduler.tasks.length} scheduled {scheduler.tasks.length === 1 ? 'task' : 'tasks'} in this profile.</p>
        </Card>

        <Card icon={<ArrowUpCircle size={16} />} title="Penumbra" onOpen={() => setView(updateWaiting(updates) ? 'updates' : 'developer')} action={updateWaiting(updates) ? 'Update' : 'Options'}>
          <p className="small home-stat">
            {updateWaiting(updates)
              ? <><ArrowUpCircle size={14} className="accent" /> Version {updates.info?.version} is available (you have {updates.info?.current})</>
              : <><CircleCheck size={14} className="green" /> {updates.info ? `Up to date (${updates.info.current})` : 'Penumbra is running'}</>}
          </p>
          <div className="home-links">
            <button className="btn sm" onClick={openTutorial}><BookOpen size={13} /> Tutorial</button>
            <button className="btn sm" onClick={() => setView('developer')}>Options</button>
          </div>
        </Card>
      </div>
    </main>
  );
}
