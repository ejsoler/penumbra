// The Projects tab: every project with its settings (instructions, folder, sources) and the chats in it.
import { useMemo, useState } from 'react';
import { ProjectForm } from '../components/ProjectEditor';
import { Folder, FolderMinus, FolderPlus, MessageSquare, Plus, Trash2 } from '../components/icons';
import { createProject, deleteProject, updateProject, useProjects, type Project } from '../projects';
import { chatController, updateConversations, useConversations } from '../session';
import { usePersistent, type Conversation } from '../store';

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const fallbackChat = (): Conversation => ({ id: 'x', title: 'New Chat', model: '', systemPrompt: '', messages: [], updatedAt: Date.now() });

export function ProjectsView({ onOpenChat }: { onOpenChat: (convId: string) => void }) {
  const projects = useProjects();
  const [conversations] = useConversations(fallbackChat);
  const [selected, setSelected] = usePersistent<string | null>('ollama-gui.projectSelected', null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const project = projects.find((p) => p.id === selected) ?? projects[0];

  const chatsOf = useMemo(() => {
    const by: Record<string, Conversation[]> = {};
    for (const c of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) if (c.projectId) (by[c.projectId] ??= []).push(c);
    return by;
  }, [conversations]);

  const add = () => {
    const p = createProject({ name: 'New project' });
    setSelected(p.id);
    setConfirmDelete(false);
  };
  const move = (chatId: string, projectId: string | undefined) =>
    updateConversations((cs) => cs.map((c) => (c.id === chatId ? { ...c, projectId } : c)));

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="sidebar-title">Projects</span>
          <button className="icon-btn" onClick={add} title="New project"><Plus size={16} /></button>
        </div>
        <div className="conv-list">
          {projects.length === 0 && <p className="muted small pad">No projects yet. A project groups chats that share instructions, a folder, and source files.</p>}
          {projects.map((p) => (
            <div key={p.id} className={`conv-item ${p.id === project?.id ? 'active' : ''}`} onClick={() => { setSelected(p.id); setConfirmDelete(false); }}>
              <Folder size={15} className="muted" />
              <div className="conv-text">
                <span className="conv-title">{p.name}</span>
                <span className="conv-sub">{plural(chatsOf[p.id]?.length ?? 0, 'chat')} · {plural(p.sources.length, 'source')}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>
      <main className="page projects-page">
        {project ? (
          <ProjectPage
            key={project.id}
            project={project}
            chats={chatsOf[project.id] ?? []}
            others={conversations.filter((c) => c.projectId !== project.id && c.messages.length)}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            onOpenChat={onOpenChat}
            onMove={move}
          />
        ) : (
          <div className="editor">
            <header className="page-head">
              <div>
                <h1><Folder size={20} className="accent" /> Projects</h1>
                <p className="muted">A project groups chats that share instructions, a local folder, and source files, so every chat in it starts with the same background. Move chats into it by dragging them in the Chat tab.</p>
              </div>
            </header>
            <button className="btn primary" onClick={add}><FolderPlus size={14} /> New project</button>
          </div>
        )}
      </main>
    </>
  );
}

function ProjectPage({ project, chats, others, confirmDelete, setConfirmDelete, onOpenChat, onMove }: {
  project: Project;
  chats: Conversation[];
  /** Chats in other projects or in none, to bring into this one. */
  others: Conversation[];
  confirmDelete: boolean;
  setConfirmDelete: (v: boolean) => void;
  onOpenChat: (convId: string) => void;
  onMove: (chatId: string, projectId: string | undefined) => void;
}) {
  const newChat = () => {
    const id = chatController.current?.newChat(project.id);
    if (id) onOpenChat(id);
  };

  return (
    <div className="editor">
      <header className="page-head">
        <div className="project-title">
          <Folder size={20} className="accent" />
          <input
            className="plan-input strong flex"
            value={project.name}
            placeholder="Project name"
            onChange={(e) => updateProject(project.id, { name: e.target.value })}
            onBlur={() => !project.name.trim() && updateProject(project.id, { name: 'Untitled project' })}
          />
        </div>
        <div className="row gap">
          <button className="btn primary" onClick={newChat}><Plus size={14} /> New chat</button>
        </div>
      </header>

      <section className="panel">
        <h4>Chats <span className="muted small">· {chats.length}</span></h4>
        {chats.length === 0 && <p className="muted small">No chats yet. Start one here, or move existing chats in below, or by dragging them onto the project in the Chat tab.</p>}
        <div className="project-chat-list">
          {chats.map((c) => (
            <div key={c.id} className="project-chat" onClick={() => onOpenChat(c.id)}>
              <MessageSquare size={14} className="muted" />
              <div className="conv-text flex">
                <span className="conv-title">{c.title}</span>
                <span className="conv-sub">{c.model || 'No model'} · {c.messages.length} messages · {ago(c.updatedAt)}</span>
              </div>
              <button className="icon-btn sm" title="Take out of this project" onClick={(e) => { e.stopPropagation(); onMove(c.id, undefined); }}><FolderMinus size={14} /></button>
            </div>
          ))}
        </div>
        {others.length > 0 && (
          <label className="field slim column project-add">
            <span>Add an existing chat</span>
            <select
              className="wide-select"
              value=""
              onChange={(e) => e.target.value && onMove(e.target.value, project.id)}
            >
              <option value="">Choose a chat…</option>
              {others.map((c) => <option key={c.id} value={c.id}>{c.title}{c.projectId ? '  (in another project)' : ''}</option>)}
            </select>
          </label>
        )}
      </section>

      <section className="panel">
        <h4>Settings</h4>
        <ProjectForm projectId={project.id} />
      </section>

      <section className="panel">
        <div className="row gap project-danger">
          {confirmDelete ? (
            <>
              <span className="muted small flex">Delete “{project.name}”? Its {chats.length} chat{chats.length === 1 ? '' : 's'} stay{chats.length === 1 ? 's' : ''}, outside any project.</span>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn sm danger" onClick={() => { deleteProject(project.id); setConfirmDelete(false); }}>Delete project</button>
            </>
          ) : (
            <button className="btn sm danger-text" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> Delete project</button>
          )}
        </div>
      </section>
    </div>
  );
}
