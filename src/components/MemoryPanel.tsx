// Memory in the interface: an editable list of notes, the Memory section of a chat's settings, and the Memory
// panel in Options (what Penumbra remembers about the user, and how memory updates).
import { useState } from 'react';
import { Brain, Check, Loader2, Pin, Plus, RefreshCw, Trash2 } from './icons';
import { chatFolder, useProjects } from '../projects';
import { updateConversations } from '../session';
import { uid, type Conversation } from '../store';
import {
  kindsOf, memoryFileStatus, SCOPE_LABEL, setChatNotes, setMemorySettings, setProjectNotes, setUserNotes, unseenUserMessages, useMemoryBusy, useMemorySettings, useUserMemory,
  looksSecret, type MemoryItem, type MemoryScope,
} from '../memory';

const TAB_LABEL: Record<MemoryScope, string> = { chat: 'Chat', project: 'Project', user: 'You' };
const KIND_TITLE: Record<string, string> = { fact: 'Fact', decision: 'Decision', preference: 'Preference', task: 'Open task', result: 'Result', about: 'About you', instruction: 'Instruction' };

/** Notes one per row: change the kind or the text, pin one so the model leaves it alone, or delete it. */
export function MemoryList({ items, scope, onChange, empty }: { items: MemoryItem[]; scope: MemoryScope; onChange: (items: MemoryItem[]) => void; empty: string }) {
  const kinds = kindsOf(scope);
  const [kind, setKind] = useState(kinds[0]);
  const [text, setText] = useState('');
  const [warn, setWarn] = useState('');
  const patch = (id: string, p: Partial<MemoryItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const add = () => {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!t) return;
    if (looksSecret(t)) return setWarn('That looks like a key, password, or private number. Memory never keeps those.');
    setWarn('');
    onChange([...items, { id: uid(), kind, text: t, at: Date.now() }]);
    setText('');
  };
  return (
    <div className="memory-list">
      {items.length === 0 && <p className="muted small">{empty}</p>}
      {items.map((i) => (
        <div key={i.id} className={`memory-item ${i.pinned ? 'pinned' : ''}`}>
          <select className="memory-kind" value={i.kind} title="Kind of note" onChange={(e) => patch(i.id, { kind: e.target.value })}>
            {[...new Set([...kinds, i.kind])].map((k) => <option key={k} value={k}>{KIND_TITLE[k] ?? k}</option>)}
          </select>
          <span className="flex" />
          <button className={`icon-btn sm ${i.pinned ? 'on' : ''}`} title={i.pinned ? 'Pinned: the model can’t change or remove it' : 'Pin: the model won’t change or remove it'} onClick={() => patch(i.id, { pinned: !i.pinned })}><Pin size={12} /></button>
          <button className="icon-btn sm" title="Delete this note" onClick={() => onChange(items.filter((x) => x.id !== i.id))}><Trash2 size={12} /></button>
          <textarea
            className="memory-text"
            rows={1}
            defaultValue={i.text}
            key={`${i.id}:${i.text}`}
            maxLength={300}
            onBlur={(e) => {
              const t = e.target.value.replace(/\s+/g, ' ').trim();
              if (t && t !== i.text && !looksSecret(t)) patch(i.id, { text: t, at: Date.now() });
              else e.target.value = i.text;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      ))}
      <div className="memory-add">
        <select className="memory-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_TITLE[k] ?? k}</option>)}
        </select>
        <input className="memory-text" value={text} placeholder="Add a note…" maxLength={300} onChange={(e) => { setText(e.target.value); setWarn(''); }} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="icon-btn sm" title="Add" disabled={!text.trim()} onClick={add}><Plus size={13} /></button>
      </div>
      {warn && <p className="lock-error small">{warn}</p>}
    </div>
  );
}

/** The Memory section of a chat's settings. */
export function MemoryPanel({ conv, onUpdate }: { conv: Conversation; onUpdate: () => void }) {
  const settings = useMemorySettings();
  const user = useUserMemory();
  const busy = useMemoryBusy() === conv.id;
  const project = useProjects().find((p) => p.id === conv.projectId);
  const [tab, setTab] = useState<MemoryScope>('chat');
  const scope: MemoryScope = tab === 'project' && !project ? 'chat' : tab;
  const items = scope === 'chat' ? conv.memory ?? [] : scope === 'project' ? project?.memory ?? [] : user;
  const save = (next: MemoryItem[]) => (scope === 'chat' ? setChatNotes(conv.id, next) : scope === 'project' ? setProjectNotes(project!.id, next) : setUserNotes(next));
  const unseen = unseenUserMessages(conv);
  const folder = chatFolder(conv);
  const fileState = memoryFileStatus(folder);
  const tabs: MemoryScope[] = project ? ['chat', 'project', 'user'] : ['chat', 'user'];
  const count = (s: MemoryScope) => (s === 'chat' ? conv.memory?.length ?? 0 : s === 'project' ? project?.memory?.length ?? 0 : user.length);

  return (
    <section className="memory-panel">
      <h4>
        <Brain size={13} /> Memory
        <label className="memory-switch" title="Notes kept from this chat, and shown to the model">
          <input type="checkbox" checked={!conv.memoryOff} onChange={(e) => updateConversations((cs) => cs.map((c) => (c.id === conv.id ? { ...c, memoryOff: e.target.checked ? undefined : true } : c)))} />
          <span>{conv.memoryOff ? 'Off' : 'On'}</span>
        </label>
      </h4>
      {conv.memoryOff ? (
        <p className="muted small">Memory is off for this chat: no notes are shown to the model or added.</p>
      ) : (
        <>
          <div className="seg memory-tabs">
            {tabs.map((s) => (
              <button key={s} className={scope === s ? 'on' : ''} onClick={() => setTab(s)}>{TAB_LABEL[s]}{count(s) ? ` · ${count(s)}` : ''}</button>
            ))}
          </div>
          <p className="muted small">
            {scope === 'chat' && 'What this chat should keep in mind.'}
            {scope === 'project' && `Shared by every chat in “${project?.name}”.`}
            {scope === 'user' && 'Lasting things about you, for every chat.'}
          </p>
          <MemoryList
            items={items}
            scope={scope}
            onChange={save}
            empty={scope === 'user' ? 'Nothing yet. Penumbra adds things you say about yourself that will matter in any chat, like your name or how you like answers.' : 'Nothing yet. After a few messages, the model writes down what is worth keeping.'}
          />
          <div className="row gap memory-actions">
            <button className="btn sm" disabled={busy || !unseen} title={unseen ? 'Look at the new messages now' : 'Nothing new to look at'} onClick={onUpdate}>
              {busy ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />} {busy ? 'Updating…' : 'Update now'}
            </button>
            {items.length > 0 && !items.some((i) => i.pinned) && <button className="link-btn small" onClick={() => confirm(`Delete all ${items.length} notes in “${SCOPE_LABEL[scope]}”?`) && save([])}>Clear</button>}
          </div>
          <p className="muted small">
            {!settings.auto
              ? 'Automatic updates are off (Options → Memory).'
              : busy
                ? 'The model is reading the latest messages…'
                : unseen >= settings.every
                  ? 'Updates after the next reply.'
                  : `${unseen} new ${unseen === 1 ? 'message' : 'messages'} since the last update; next update after ${settings.every - unseen} more.`}
          </p>
          {settings.file && (
            <p className="muted small memory-file">
              {folder
                ? fileState && fileState !== 'saved'
                  ? <>MEMORY.md: {fileState}.</>
                  : <><Check size={11} /> Also saved as MEMORY.md in the folder{fileState === 'saved' ? '' : ' when notes change'}.</>
                : 'Choose a folder for this chat or its project to also save these notes as MEMORY.md.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Options → Memory: when notes update, the MEMORY.md file, and what Penumbra remembers about the user. */
export function MemorySettingsPanel() {
  const settings = useMemorySettings();
  const user = useUserMemory();
  return (
    <section className="panel" id="memory">
      <h4><Brain size={14} /> Memory</h4>
      <p className="muted small">Chats keep short notes so they don't forget things when they get long. The model that answers also reads the new messages every few messages and updates the notes (a quick extra step, after the reply), and can search the notes and earlier messages with its tools. Notes stay on this computer.</p>
      <label className="check-row">
        <input type="checkbox" checked={settings.auto} onChange={(e) => setMemorySettings({ auto: e.target.checked })} />
        <span>Update the notes automatically</span>
      </label>
      <label className="field slim">
        <span>Update after every <small className="muted">of your messages</small></span>
        <input className="num" type="number" min={1} max={30} value={settings.every} disabled={!settings.auto} onChange={(e) => e.target.value !== '' && setMemorySettings({ every: Number(e.target.value) })} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={settings.file} onChange={(e) => setMemorySettings({ file: e.target.checked })} />
        <span>Save a MEMORY.md file in the folder of a chat or project that has one</span>
      </label>
      <p className="muted small">Only chat and project notes go in the file, never what is remembered about you, and a MEMORY.md that Penumbra didn't write is never overwritten.</p>

      <h4 className="memory-sub">About you <span className="muted small">· {user.length}</span></h4>
      <p className="muted small">Lasting things worth knowing in every chat: your name, your language, how you like answers. Edit or pin them, or turn memory off for a single chat in its settings.</p>
      <MemoryList items={user} scope="user" onChange={setUserNotes} empty="Nothing yet." />
      {user.length > 0 && (
        <button className="btn sm danger-text" onClick={() => confirm('Forget everything remembered about you?') && setUserNotes([])}><Trash2 size={13} /> Forget everything about me</button>
      )}
    </section>
  );
}
