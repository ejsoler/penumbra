// The Backup tab: save chats, agents, skills, images, scheduled tasks, and settings in one .zip, and restore
// from one. Each kind can be backed up in full or item by item.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAgents } from '../agents/agents';
import { AgentAvatar } from '../components/AgentAvatar';
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, DatabaseBackup, FolderOpen, Loader2, Search } from '../components/icons';
import { backupContents, chatImages, makeBackup, restoreBackup, savedTasks, SETTING_GROUPS, type BackupChoice, type RestoreReport } from '../backup';
import { host, type BackupImage, type BackupSkill, type OpenedBackup } from '../host';
import { imageUrl } from '../images';
import { getConversations } from '../session';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const date = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const REPORT_KEY = 'ollama-gui.restoreReport';

interface Item {
  id: string;
  label: string;
  sub?: string;
  icon?: ReactNode;
}

/** One kind of thing to back up: a checkbox for all of it, and a list to choose items. */
function Category({ title, items, selected, setSelected, note, extra }: {
  title: string;
  items: Item[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  note?: string;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = new Set(selected);
  const count = items.filter((i) => chosen.has(i.id)).length;
  const all = items.length > 0 && count === items.length;
  const shown = query ? items.filter((i) => `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(query.toLowerCase())) : items;
  const toggle = (id: string) => setSelected(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className={`backup-cat ${items.length ? '' : 'empty'}`}>
      <div className="backup-cat-head">
        <input
          type="checkbox"
          aria-label={`All ${title.toLowerCase()}`}
          checked={all}
          disabled={!items.length}
          ref={(el) => { if (el) el.indeterminate = count > 0 && !all; }}
          onChange={() => setSelected(all ? [] : items.map((i) => i.id))}
        />
        <button className="backup-cat-title" disabled={!items.length} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <b>{title}</b>
          <span className="muted small">{items.length ? (all ? `all ${items.length}` : `${count} of ${items.length}`) : 'none'}</span>
        </button>
        {note && <span className="muted small backup-note">{note}</span>}
      </div>
      {open && items.length > 0 && (
        <div className="backup-items">
          <div className="row gap backup-items-tools">
            {items.length > 8 && (
              <label className="search-box backup-search">
                <Search size={13} />
                <input value={query} placeholder={`Search ${title.toLowerCase()}`} onChange={(e) => setQuery(e.target.value)} />
              </label>
            )}
            <button className="link-btn small" onClick={() => setSelected(items.map((i) => i.id))}>All</button>
            <button className="link-btn small" onClick={() => setSelected([])}>None</button>
            {extra}
          </div>
          <div className="backup-list">
            {shown.map((i) => (
              <label key={i.id} className="backup-item">
                <input type="checkbox" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} />
                {i.icon}
                <span className="backup-item-text">
                  <span className="backup-item-label">{i.label}</span>
                  {i.sub && <span className="muted small">{i.sub}</span>}
                </span>
              </label>
            ))}
            {!shown.length && <p className="muted small">Nothing matches.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const imageItems = (images: BackupImage[], key: 'file' | 'name', thumbs: boolean): Item[] =>
  images.map((h) => ({
    id: String(h[key]),
    label: h.prompt || 'Image',
    sub: [h.width && h.height ? `${h.width}×${h.height}` : '', date(h.at), mb(h.size)].filter(Boolean).join(' · '),
    icon: thumbs ? <img className="backup-thumb" src={imageUrl(h.file)} alt="" loading="lazy" /> : undefined,
  }));
const skillItems = (skills: BackupSkill[]): Item[] => skills.map((s) => ({ id: s.id, label: s.name, sub: s.description }));
const settingItems = (groups: typeof SETTING_GROUPS): Item[] => groups.map((g) => ({ id: g.id, label: g.label }));

const EMPTY: BackupChoice = { chats: [], agents: [], tasks: [], skills: [], images: [], settings: [] };

function BackUp() {
  const agents = useAgents();
  const [chats] = useState(() => getConversations().filter((c) => c.messages.length));
  const [tasks] = useState(savedTasks);
  const [files, setFiles] = useState<{ skills: BackupSkill[]; images: BackupImage[] } | null>(null);
  const [choice, setChoice] = useState<BackupChoice>(EMPTY);
  const [state, setState] = useState<'idle' | 'saving' | { file: string; size: number } | { error: string }>('idle');

  useEffect(() => {
    host()!.backup.summary().then((f) => {
      setFiles(f);
      setChoice({
        chats: chats.map((c) => c.id),
        agents: agents.map((a) => a.id),
        tasks: tasks.map((t) => t.id),
        skills: f.skills.map((s) => s.id),
        images: f.images.map((i) => i.file),
        settings: SETTING_GROUPS.map((g) => g.id),
      });
    }).catch((e) => setState({ error: clean(e) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof BackupChoice) => (ids: string[]) => setChoice((c) => ({ ...c, [k]: ids }));
  const imageBytes = (files?.images ?? []).filter((i) => choice.images.includes(i.file)).reduce((n, i) => n + i.size, 0);
  const inChosenChats = useMemo(() => new Set(chats.filter((c) => choice.chats.includes(c.id)).flatMap(chatImages)), [chats, choice.chats]);
  const nothing = Object.values(choice).every((v) => !v.length);

  const save = async () => {
    setState('saving');
    try {
      const r = await makeBackup(choice);
      setState(r ?? 'idle');
    } catch (e) {
      setState({ error: clean(e) });
    }
  };

  if (!files) return <section className="panel"><p className="muted"><Loader2 size={13} className="spin" /> Loading…</p></section>;
  return (
    <section className="panel backup-panel">
      <h4><Archive size={14} /> Back up</h4>
      <p className="muted small">Everything is chosen. Uncheck what you don't need, or open a list to pick items.</p>
      <Category
        title="Chats"
        items={chats.map((c) => ({ id: c.id, label: c.title || 'Untitled chat', sub: `${c.messages.length} messages · ${date(c.updatedAt)}` }))}
        selected={choice.chats}
        setSelected={set('chats')}
        note="with their attachments and widgets"
      />
      <Category
        title="Agents"
        items={agents.map((a) => ({ id: a.id, label: a.name, sub: a.description, icon: <AgentAvatar agent={a} size={22} /> }))}
        selected={choice.agents}
        setSelected={set('agents')}
      />
      <Category title="Skills" items={skillItems(files.skills)} selected={choice.skills} setSelected={set('skills')} />
      <Category
        title="Images"
        items={imageItems(files.images, 'file', true)}
        selected={choice.images}
        setSelected={set('images')}
        note={choice.images.length ? mb(imageBytes) : undefined}
        extra={inChosenChats.size > 0 && (
          <button className="link-btn small" onClick={() => set('images')(files.images.filter((i) => inChosenChats.has(i.file)).map((i) => i.file))}>Only those in the chosen chats</button>
        )}
      />
      <Category
        title="Scheduled tasks"
        items={tasks.map((t) => ({ id: t.id, label: t.name, sub: t.kind === 'command' ? t.command : t.prompt }))}
        selected={choice.tasks}
        setSelected={set('tasks')}
        note="with their run logs"
      />
      <Category title="Settings" items={settingItems(SETTING_GROUPS)} selected={choice.settings} setSelected={set('settings')} />

      <p className="muted small">
        Not included: downloaded models (get them again in Discover and Images) and profile passwords. The backup isn't encrypted, so keep it somewhere safe.
      </p>
      <div className="row gap backup-actions">
        <button className="btn primary" disabled={nothing || state === 'saving'} onClick={save}>
          {state === 'saving' ? <Loader2 size={14} className="spin" /> : <Archive size={14} />} Back up…
        </button>
        {typeof state === 'object' && 'file' in state && (
          <span className="backup-done small">
            <Check size={13} /> Saved {state.file.split(/[\\/]/).pop()} ({mb(state.size)})
            <button className="link-btn small" onClick={() => host()!.backup.reveal(state.file)}><FolderOpen size={12} /> Show in folder</button>
          </span>
        )}
        {typeof state === 'object' && 'error' in state && <span className="lock-error small">{state.error}</span>}
      </div>
    </section>
  );
}

function Restore() {
  const [backup, setBackup] = useState<OpenedBackup | null>(null);
  const [choice, setChoice] = useState<BackupChoice>(EMPTY);
  const [state, setState] = useState<'idle' | 'opening' | 'confirm' | 'restoring' | { error: string }>('idle');
  const [report] = useState<RestoreReport | null>(() => {
    try {
      const r = sessionStorage.getItem(REPORT_KEY);
      sessionStorage.removeItem(REPORT_KEY);
      return r ? JSON.parse(r) : null;
    } catch {
      return null;
    }
  });
  const contents = useMemo(() => (backup ? backupContents(backup) : null), [backup]);

  const open = async () => {
    setState('opening');
    try {
      const b = await host()!.backup.open();
      if (b) {
        const c = backupContents(b);
        setBackup(b);
        // Settings replace the current ones, so they start unchecked.
        setChoice({ chats: c.chats.map((x) => x.id), agents: c.agents.map((x) => x.id), tasks: c.tasks.map((x) => x.id), skills: b.skills.map((s) => s.id), images: b.images.map((i) => String(i.name)), settings: [] });
      }
      setState('idle');
    } catch (e) {
      setState({ error: clean(e) });
    }
  };
  const restore = async () => {
    if (!backup) return;
    setState('restoring');
    try {
      const r = await restoreBackup(backup, choice);
      try {
        sessionStorage.setItem(REPORT_KEY, JSON.stringify(r));
      } catch {
        /* storage unavailable */
      }
      window.location.reload();
    } catch (e) {
      setState({ error: clean(e) });
    }
  };
  const set = (k: keyof BackupChoice) => (ids: string[]) => setChoice((c) => ({ ...c, [k]: ids }));
  const nothing = Object.values(choice).every((v) => !v.length);
  const added = report ? Object.entries(report.added).filter(([, n]) => n).map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, '') : k}`) : [];

  return (
    <section className="panel backup-panel">
      <h4><ArchiveRestore size={14} /> Restore</h4>
      {report && (
        <div className="banner backup-report">
          <Check size={14} /> Restored{added.length ? `: ${added.join(', ')}` : ''}{report.settings ? `${added.length ? ',' : ':'} settings` : ''}.
          {report.skipped ? ` ${report.skipped} ${report.skipped === 1 ? 'item was' : 'items were'} already here.` : ''}
          {!added.length && !report.settings && !report.skipped ? ' Nothing was chosen.' : ''}
        </div>
      )}
      <p className="muted small">
        Adds what you choose from a backup to this profile. Nothing here is replaced: items already here are skipped, and changed ones are added as copies. Restored scheduled tasks start paused.
      </p>
      <div className="row gap">
        <button className="btn" disabled={state === 'opening' || state === 'restoring'} onClick={open}>
          {state === 'opening' ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />} {backup ? 'Open another backup…' : 'Open a backup…'}
        </button>
        {typeof state === 'object' && <span className="lock-error small">{state.error}</span>}
      </div>

      {backup && contents && (
        <>
          <p className="small backup-source">
            <b>{backup.file.split(/[\\/]/).pop()}</b> <span className="muted">· made {date(backup.createdAt)} with Penumbra {backup.app}</span>
          </p>
          <Category title="Chats" items={contents.chats.map((c) => ({ id: c.id, label: c.title || 'Untitled chat', sub: `${c.messages.length} messages · ${date(c.updatedAt)}` }))} selected={choice.chats} setSelected={set('chats')} />
          <Category title="Agents" items={contents.agents.map((a) => ({ id: a.id, label: a.name, sub: a.description, icon: <AgentAvatar agent={a} size={22} /> }))} selected={choice.agents} setSelected={set('agents')} />
          <Category title="Skills" items={skillItems(backup.skills)} selected={choice.skills} setSelected={set('skills')} />
          <Category title="Images" items={imageItems(backup.images, 'name', false)} selected={choice.images} setSelected={set('images')} note="saved in your images folder" />
          <Category title="Scheduled tasks" items={contents.tasks.map((t) => ({ id: t.id, label: t.name, sub: t.kind === 'command' ? t.command : t.prompt }))} selected={choice.tasks} setSelected={set('tasks')} />
          <Category title="Settings" items={settingItems(contents.settingGroups)} selected={choice.settings} setSelected={set('settings')} note="replace your current ones" />

          {state === 'confirm' || state === 'restoring' ? (
            <div className="backup-confirm">
              <span className="small flex">Restore the chosen items into this profile? Penumbra reloads when it's done.</span>
              <button className="btn sm" disabled={state === 'restoring'} onClick={() => setState('idle')}>Cancel</button>
              <button className="btn primary sm" disabled={state === 'restoring'} onClick={restore}>
                {state === 'restoring' && <Loader2 size={13} className="spin" />} Restore
              </button>
            </div>
          ) : (
            <div className="row gap backup-actions">
              <button className="btn primary" disabled={nothing} onClick={() => setState('confirm')}><ArchiveRestore size={14} /> Restore…</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function BackupView() {
  if (!host()) return <main className="page"><p className="muted">Backups need the desktop app.</p></main>;
  return (
    <main className="page backup-page">
      <header className="page-head">
        <div>
          <h1><DatabaseBackup size={20} className="accent" /> Backup</h1>
          <p className="muted">Save chats, agents, skills, images, scheduled tasks, and settings in one file, and bring them back here, in another profile, or on another computer.</p>
        </div>
      </header>
      <BackUp />
      <Restore />
    </main>
  );
}
