// The window for a project: its name, instructions, local folder, and sources.
import { useEffect, useRef, useState } from 'react';
import { host } from '../host';
import { uid } from '../store';
import { deleteProject, MAX_PROJECT_SOURCES, readSourceFile, sourcesSize, updateProject, useProjects, type ProjectSource } from '../projects';
import { FileText, Folder, FolderOpen, Plus, StickyNote, Trash2, X } from './icons';

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function ProjectEditor({ projectId, chatCount, onClose }: { projectId: string; chatCount: number; onClose: () => void }) {
  const project = useProjects().find((p) => p.id === projectId);
  const [error, setError] = useState('');
  const [note, setNote] = useState<{ name: string; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!project) return null;
  const total = sourcesSize(project);

  /** Adds sources, unless that would fill the browser's storage. */
  const addSources = (list: ProjectSource[], problems: string[] = []) => {
    if (list.length) {
      if (total + list.reduce((n, s) => n + s.text.length, 0) > MAX_PROJECT_SOURCES) {
        problems.push(`A project's sources can hold up to ${kb(MAX_PROJECT_SOURCES)} of text`);
      } else if (!updateProject(project.id, (p) => ({ sources: [...p.sources, ...list] }))) {
        problems.push("Couldn't save: the app's storage is full");
      }
    }
    setError(problems.join(' · '));
  };
  const addFiles = async (files: FileList | File[]) => {
    const ok: ProjectSource[] = [];
    const problems: string[] = [];
    for (const f of files) {
      try {
        ok.push(await readSourceFile(f));
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    addSources(ok, problems);
  };
  const pickFolder = async () => {
    const f = await host()?.tools.pickFolder();
    if (f) updateProject(project.id, { folder: f });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal project-editor"
        role="dialog"
        aria-label="Project"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
      >
        <div className="project-head">
          <Folder size={18} className="accent" />
          <input className="plan-input strong flex" value={project.name} placeholder="Project name" onChange={(e) => updateProject(project.id, { name: e.target.value })} onBlur={() => !project.name.trim() && updateProject(project.id, { name: 'Untitled project' })} />
          <button className="icon-btn sm" title="Close" onClick={onClose}><X size={14} /></button>
        </div>

        <section>
          <h4>Instructions</h4>
          <textarea
            className="plan-text"
            rows={5}
            value={project.instructions}
            placeholder="How should the model answer in this project? For example: reply in Spanish, use a formal tone, and always cite the sources."
            onChange={(e) => updateProject(project.id, { instructions: e.target.value })}
          />
          <p className="muted small">Every chat in the project follows them.</p>
        </section>

        <section>
          <h4>Folder</h4>
          <div className="folder-row">
            {project.folder ? (
              <>
                <button className="link-btn mono folder-path" title={project.folder} onClick={() => host()?.tools.reveal(project.folder!)}>{project.folder.split(/[\\/]/).slice(-2).join('/')}</button>
                <button className="icon-btn sm" title="Change folder" onClick={pickFolder}><FolderOpen size={13} /></button>
                <button className="icon-btn sm" title="Remove folder" onClick={() => updateProject(project.id, { folder: undefined })}><X size={12} /></button>
              </>
            ) : (
              <button className="btn sm" disabled={!host()} onClick={pickFolder}><FolderOpen size={13} /> Choose…</button>
            )}
          </div>
          <p className="muted small">Chats in the project use it for file and terminal tools, unless a chat has its own folder.</p>
        </section>

        <section>
          <h4>Sources <span className="muted small">{project.sources.length ? `· ${kb(total)}` : ''}</span></h4>
          {project.sources.length === 0 && <p className="muted small">Add text files (notes, code, documents saved as text) the model should know in every chat of this project. You can also drop files here.</p>}
          <div className="project-sources">
            {project.sources.map((s) => (
              <div key={s.id} className="project-source">
                <div className="row gap">
                  <FileText size={14} className="muted" />
                  <button className="link-btn flex source-name" onClick={() => setOpen(open === s.id ? null : s.id)} title="Show the text">{s.name}</button>
                  <span className="muted small">{kb(s.text.length)}</span>
                  <button className="icon-btn sm" title="Remove source" onClick={() => updateProject(project.id, (p) => ({ sources: p.sources.filter((x) => x.id !== s.id) }))}><Trash2 size={13} /></button>
                </div>
                {open === s.id && <pre className="source-text">{s.text.slice(0, 4000)}{s.text.length > 4000 ? '\n…' : ''}</pre>}
              </div>
            ))}
          </div>
          {note ? (
            <div className="project-note">
              <input className="plan-input" autoFocus value={note.name} placeholder="Note title" onChange={(e) => setNote({ ...note, name: e.target.value })} />
              <textarea className="plan-text" rows={4} value={note.text} placeholder="Write or paste the text" onChange={(e) => setNote({ ...note, text: e.target.value })} />
              <div className="row gap">
                <span className="flex" />
                <button className="btn sm" onClick={() => setNote(null)}>Cancel</button>
                <button
                  className="btn sm primary"
                  disabled={!note.text.trim()}
                  onClick={() => {
                    addSources([{ id: uid(), name: note.name.trim() || 'Note', text: note.text, addedAt: Date.now() }]);
                    setNote(null);
                  }}
                >
                  Add note
                </button>
              </div>
            </div>
          ) : (
            <div className="row gap">
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              <button className="btn sm" onClick={() => fileInput.current?.click()}><Plus size={13} /> Add files…</button>
              <button className="btn sm" onClick={() => setNote({ name: '', text: '' })}><StickyNote size={13} /> Add a note</button>
            </div>
          )}
          {error && <p className="lock-error small">{error}</p>}
        </section>

        <div className="modal-actions project-actions">
          {confirmDelete ? (
            <>
              <span className="muted small flex">Delete this project? Its {chatCount} chat{chatCount === 1 ? '' : 's'} stay{chatCount === 1 ? 's' : ''}, outside any project.</span>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn sm danger" onClick={() => { deleteProject(project.id); onClose(); }}>Delete project</button>
            </>
          ) : (
            <>
              <button className="btn sm danger-text" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> Delete project</button>
              <span className="flex" />
              <button className="btn primary" onClick={onClose}>Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
