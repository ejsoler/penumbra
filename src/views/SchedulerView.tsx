import { useState } from 'react';
import type { OllamaState } from '../store';
import { useAgents } from '../agents/agents';
import { host } from '../host';
import { useContextMenu } from '../components/ContextMenu';
import { CalendarClock, CircleAlert, CircleCheck, FolderOpen, Loader2, MessageSquare, Play, Plus, Trash2, TriangleAlert, X } from '../components/icons';
import {
  deleteTask, describeSchedule, describeWhen, newTaskId, runTaskNow, saveTask, setSchedulerSettings, setTaskEnabled, useScheduler,
  type PreApproval, type Schedule, type ScheduledTask, type TaskKind,
} from '../scheduler';

const KINDS: { id: TaskKind; label: string; hint: string }[] = [
  { id: 'prompt', label: 'Prompt', hint: 'A model or agent answers a prompt. With an agent, it can use the agent’s tools and skills.' },
  { id: 'orchestrator', label: 'Orchestrator', hint: 'The orchestrator plans the goal and runs the plan right away, since nobody is there to review it.' },
  { id: 'command', label: 'Command', hint: 'Runs a terminal command in a folder, with no model. It runs without asking, so check it carefully.' },
];

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Draft = Omit<ScheduledTask, 'nextRun' | 'createdAt'>;

const blank = (model: string): Draft => ({
  id: newTaskId(),
  name: 'New task',
  enabled: true,
  kind: 'prompt',
  prompt: '',
  model,
  preApproved: [],
  schedule: { type: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] },
});

/** datetime-local wants "YYYY-MM-DDTHH:MM" in local time. */
const toLocalInput = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

export function SchedulerView({ ollama, onOpenChat }: { ollama: OllamaState; onOpenChat: (convId: string) => void }) {
  const { tasks, settings, running } = useScheduler();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const menu = useContextMenu();
  // Local models first: a cloud model would send every run to a remote server.
  const models = ollama.models
    .filter((m) => !(ollama.capabilities[m.name] ?? []).includes('embedding'))
    .sort((a, b) => Number(!!a.remote_host) - Number(!!b.remote_host));
  const defaultModel = models.find((m) => !m.remote_host)?.name ?? models[0]?.name ?? '';

  const open = (t: ScheduledTask | null) => {
    setSelected(t?.id ?? null);
    setDraft(t ? { ...t } : null);
  };
  const current = draft ?? null;

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="sidebar-title">Scheduled tasks</span>
          <button className="icon-btn" title="New task" onClick={() => { setSelected(null); setDraft(blank(defaultModel)); }}><Plus size={16} /></button>
        </div>
        <div className="conv-list">
          {!tasks.length && <p className="muted small list-empty">No tasks yet.</p>}
          {tasks.map((t) => (
            <div
              key={t.id}
              className={`conv-item ${t.id === selected ? 'active' : ''} ${t.enabled ? '' : 'dim'}`}
              onClick={() => open(t)}
              onContextMenu={(e) =>
                menu(e, [
                  { label: 'Run now', icon: Play, onClick: () => runTaskNow(t.id), disabled: running === t.id },
                  { label: 'Open chat', icon: MessageSquare, onClick: () => t.convId && onOpenChat(t.convId), disabled: !t.convId },
                  'separator',
                  { label: 'Delete task', icon: Trash2, danger: true, onClick: () => confirm(`Delete the task "${t.name}"? Its chat stays.`) && (deleteTask(t.id), t.id === selected && open(null)) },
                ])
              }
            >
              <div className="conv-text">
                <span className="conv-title"><TaskStatus t={t} running={running === t.id} /> {t.name}</span>
                <span className="conv-sub">{t.enabled && t.nextRun ? `Next ${describeWhen(t.nextRun)}` : t.enabled ? 'Nothing scheduled' : 'Off'}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>
      <main className="page agents-page">
        {current ? (
          <TaskEditor
            key={current.id}
            draft={current}
            saved={tasks.find((t) => t.id === current.id)}
            running={running === current.id}
            models={models.map((m) => ({ name: m.name, label: `${m.name}${m.details.parameter_size ? ` (${m.details.parameter_size})` : ''}${m.remote_host ? ' · cloud' : ''}` }))}
            onChange={setDraft}
            onSave={(d) => {
              const t = saveTask(d);
              setSelected(t.id);
              setDraft({ ...t });
            }}
            onDelete={() => {
              deleteTask(current.id);
              open(null);
            }}
            onOpenChat={onOpenChat}
          />
        ) : (
          <SchedulerHome
            count={tasks.length}
            onNew={() => setDraft(blank(defaultModel))}
            settings={settings}
          />
        )}
      </main>
    </>
  );
}

function TaskStatus({ t, running }: { t: ScheduledTask; running: boolean }) {
  if (running || t.lastStatus === 'running') return <Loader2 size={12} className="spin accent" />;
  if (t.lastStatus === 'waiting') return <TriangleAlert size={12} className="amber" />;
  if (t.lastStatus === 'error') return <CircleAlert size={12} className="red" />;
  if (t.lastStatus === 'ok') return <CircleCheck size={12} className="green" />;
  return <CalendarClock size={12} className="muted" />;
}

function SchedulerHome({ count, onNew, settings }: { count: number; onNew: () => void; settings: { menuBar: boolean; notify: boolean } }) {
  return (
    <div className="editor">
      <header className="page-head">
        <div>
          <h1><CalendarClock size={20} className="accent" /> Scheduler</h1>
          <p className="muted">Run prompts, agents, orchestrator goals, or commands at a set time or on repeat. Each task has its own chat with every run’s result.</p>
        </div>
        <button className="btn primary" onClick={onNew}><Plus size={14} /> New task</button>
      </header>
      {!count && (
        <section className="panel">
          <h4>Ideas</h4>
          <ul className="muted small idea-list">
            <li>Every weekday at 8:00, the Researcher summarizes the weather and top tech news.</li>
            <li>Every Friday at 17:00, the Coder runs the tests in a project folder and reports what failed.</li>
            <li>Every hour, a command checks that a website answers.</li>
          </ul>
        </section>
      )}
      <section className="panel">
        <h4>While tasks are on</h4>
        <label className="check-row">
          <input type="checkbox" checked={settings.menuBar} onChange={(e) => setSchedulerSettings({ menuBar: e.target.checked })} />
          <span>Keep Penumbra in the menu bar when the window is closed <span className="muted">(so tasks run on time; quit from the menu bar icon)</span></span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={settings.notify} onChange={(e) => setSchedulerSettings({ notify: e.target.checked })} />
          <span>Notify me when a task finishes or needs my OK</span>
        </label>
        <p className="hint muted">Tasks run one at a time, and wait while you’re using the chat. A run missed while Penumbra was quit runs once when it opens.</p>
      </section>
    </div>
  );
}

function TaskEditor({ draft: d, saved, running, models, onChange, onSave, onDelete, onOpenChat }: {
  draft: Draft;
  saved?: ScheduledTask;
  running: boolean;
  models: { name: string; label: string }[];
  onChange: (d: Draft) => void;
  onSave: (d: Draft) => void;
  onDelete: () => void;
  onOpenChat: (convId: string) => void;
}) {
  const agents = useAgents();
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const setSchedule = (s: Schedule) => set({ schedule: s });
  const s = d.schedule;
  const agent = agents.find((a) => a.id === d.agentId);
  const FIELDS = ['name', 'enabled', 'kind', 'prompt', 'agentId', 'model', 'folder', 'command', 'preApproved', 'schedule'] as const;
  const dirty = !saved || FIELDS.some((k) => JSON.stringify(saved[k]) !== JSON.stringify(d[k]));
  const togglePre = (p: PreApproval, on: boolean) => set({ preApproved: on ? [...new Set([...d.preApproved, p])] : d.preApproved.filter((x) => x !== p) });
  const pickFolder = async () => {
    const f = await host()?.tools.pickFolder();
    if (f) set({ folder: f });
  };
  const usesWeb = d.kind === 'orchestrator' || !!agent?.tools.includes('web');
  const usesTerminal = d.kind === 'orchestrator' || !!agent?.tools.includes('terminal');
  const cloud = (name: string) => models.find((m) => m.name === name)?.label.endsWith('· cloud');

  const problem =
    !d.name.trim() ? 'Give the task a name.'
    : d.kind === 'command' ? (!d.command?.trim() ? 'Enter a command.' : !d.folder ? 'Choose the folder the command runs in.' : '')
    : !d.prompt.trim() ? (d.kind === 'orchestrator' ? 'Describe the goal.' : 'Write the prompt.')
    : !(agent?.model || d.model) ? 'Choose a model.'
    : s.type === 'once' && s.at <= Date.now() && dirty ? 'Pick a time in the future.'
    : s.type === 'daily' && !s.days.length ? 'Pick at least one day.'
    : '';

  return (
    <div className="editor">
      <header className="page-head">
        <div className="editor-title">
          <input className="title-input" value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label="Task name" />
          <span className="subtitle-input muted">{saved ? (saved.enabled && saved.nextRun ? `Next run ${describeWhen(saved.nextRun)} · ${describeSchedule(saved.schedule)}` : saved.enabled ? 'Nothing scheduled' : 'Off') : 'Not saved yet'}</span>
        </div>
        <div className="row gap">
          {saved?.convId && <button className="btn" onClick={() => onOpenChat(saved.convId!)}><MessageSquare size={14} /> Runs</button>}
          {saved && <button className="btn" disabled={running || dirty} title={dirty ? 'Save first' : 'Run it now, once'} onClick={() => runTaskNow(saved.id)}>{running ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Run now</button>}
          <button className="btn primary" disabled={!!problem || !dirty} title={problem} onClick={() => onSave(d)}>{saved ? 'Save' : 'Create task'}</button>
        </div>
      </header>

      {saved?.lastStatus === 'error' && <div className="banner error">Last run{saved.lastRun ? ` (${new Date(saved.lastRun).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})` : ''} didn’t finish: {saved.lastError}</div>}
      {saved?.lastStatus === 'waiting' && <div className="banner warn">It’s waiting for your OK in its chat. <button className="link" onClick={() => onOpenChat(saved.convId!)}>Open chat</button></div>}

      <section className="panel">
        <h4>What it does</h4>
        <div className="seg seg-wide">
          {KINDS.map((k) => <button key={k.id} className={d.kind === k.id ? 'on' : ''} onClick={() => set({ kind: k.id })}>{k.label}</button>)}
        </div>
        <p className="hint muted">{KINDS.find((k) => k.id === d.kind)!.hint}</p>

        {d.kind === 'command' ? (
          <label className="field column">
            <span>Command</span>
            <input className="text mono" value={d.command ?? ''} placeholder="npm test" onChange={(e) => set({ command: e.target.value })} />
          </label>
        ) : (
          <>
            {d.kind === 'prompt' && (
              <label className="field slim column">
                <span>Answered by</span>
                <select className="wide-select" value={d.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || undefined })}>
                  <option value="">The model below (no agent)</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>Agent: {a.name}{a.model ? ` · ${a.model}` : ''}</option>)}
                </select>
              </label>
            )}
            {!(d.kind === 'prompt' && agent) && (
              <label className="field slim column">
                <span>{d.kind === 'orchestrator' ? 'Planner model' : 'Model'}</span>
                <select className="wide-select" value={d.model} onChange={(e) => set({ model: e.target.value })}>
                  {!models.length && <option value="">No models installed</option>}
                  {models.map((m) => <option key={m.name} value={m.name}>{m.label}</option>)}
                  {d.model && !models.some((m) => m.name === d.model) && <option value={d.model}>{d.model} (not installed)</option>}
                </select>
              </label>
            )}
            {cloud(agent?.model || d.model) && <p className="hint warn">This is a cloud model: every run is sent to Ollama’s servers.</p>}
            <label className="field column">
              <span>{d.kind === 'orchestrator' ? 'Goal' : 'Prompt'}</span>
              <textarea
                className="instructions"
                rows={5}
                value={d.prompt}
                placeholder={d.kind === 'orchestrator' ? 'Find this week’s top three AI news stories and write a short summary email for my team.' : 'Summarize today’s weather in San Juan, Puerto Rico in three lines.'}
                onChange={(e) => set({ prompt: e.target.value })}
              />
            </label>
            {d.kind === 'prompt' && !agent && <p className="hint muted">Without an agent, it answers with skills only. To search the web, read files, or run commands, pick an agent with those tools.</p>}
          </>
        )}

        <div className="field slim column">
          <span>Folder <small className="muted">{d.kind === 'command' ? 'where the command runs' : 'optional, for file and terminal tools'}</small></span>
          <div className="row gap">
            {d.folder ? (
              <>
                <span className="mono small folder-path" title={d.folder}>{d.folder}</span>
                <button className="icon-btn sm" title="Remove folder" onClick={() => set({ folder: undefined })}><X size={12} /></button>
              </>
            ) : (
              <button className="btn sm" disabled={!host()} onClick={pickFolder}><FolderOpen size={13} /> Choose…</button>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <h4>When</h4>
        <div className="seg seg-wide">
          <button className={s.type === 'once' ? 'on' : ''} onClick={() => setSchedule({ type: 'once', at: s.type === 'once' ? s.at : Date.now() + 3600000 })}>Once</button>
          <button className={s.type === 'daily' ? 'on' : ''} onClick={() => setSchedule({ type: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] })}>Daily / weekly</button>
          <button className={s.type === 'every' ? 'on' : ''} onClick={() => setSchedule({ type: 'every', minutes: 60 })}>Repeat every…</button>
        </div>
        {s.type === 'once' && (
          <label className="field slim">
            <span>At</span>
            <input className="text" type="datetime-local" value={toLocalInput(s.at)} onChange={(e) => e.target.value && setSchedule({ type: 'once', at: new Date(e.target.value).getTime() })} />
          </label>
        )}
        {s.type === 'daily' && (
          <div className="row gap schedule-row">
            <input className="text time-input" type="time" value={s.time} onChange={(e) => e.target.value && setSchedule({ ...s, time: e.target.value })} />
            <div className="day-chips">
              {DAYS.map((label, i) => (
                <button key={i} className={`day-chip ${s.days.includes(i) ? 'on' : ''}`} title={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]} onClick={() => setSchedule({ ...s, days: s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i].sort() })}>{label}</button>
              ))}
            </div>
            <button className="link-btn small" onClick={() => setSchedule({ ...s, days: [1, 2, 3, 4, 5] })}>Weekdays</button>
            <button className="link-btn small" onClick={() => setSchedule({ ...s, days: [0, 1, 2, 3, 4, 5, 6] })}>Every day</button>
          </div>
        )}
        {s.type === 'every' && (
          <div className="row gap schedule-row">
            <span>Every</span>
            <input
              className="num"
              type="number"
              min={1}
              value={s.minutes % 60 === 0 ? s.minutes / 60 : s.minutes}
              onChange={(e) => {
                const n = Math.max(1, Number(e.target.value) || 1);
                setSchedule({ type: 'every', minutes: s.minutes % 60 === 0 ? n * 60 : n });
              }}
            />
<select
              value={s.minutes % 60 === 0 ? 'h' : 'm'}
              onChange={(e) => {
                // Keep the number, change the unit: "2 hours" becomes "2 minutes".
                const n = s.minutes % 60 === 0 ? s.minutes / 60 : s.minutes;
                setSchedule({ type: 'every', minutes: e.target.value === 'h' ? n * 60 : n === 1 ? 1 : n });
              }}
            >
              <option value="m">minutes</option>
              <option value="h">hours</option>
            </select>
            <span className="muted small">from when you save it</span>
          </div>
        )}
        <p className="hint muted">{describeSchedule(s)}</p>
        <label className="check-row">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>On</span>
        </label>
      </section>

      {d.kind !== 'command' && (usesWeb || usesTerminal) && (
        <section className="panel">
          <h4>Without asking</h4>
          <p className="muted small">Nobody may be at the computer when it runs. Choose what this task may do on its own; anything else waits for your OK and notifies you.</p>
          {usesWeb && (
            <label className="check-row">
              <input type="checkbox" checked={d.preApproved.includes('web')} onChange={(e) => togglePre('web', e.target.checked)} />
              <span><b>Open websites</b> <span className="muted small">read any page it finds (searching never asks)</span></span>
            </label>
          )}
          {usesTerminal && (
            <label className="check-row">
              <input type="checkbox" checked={d.preApproved.includes('terminal')} onChange={(e) => togglePre('terminal', e.target.checked)} />
              <span><b>Run terminal commands</b> <span className="muted small">in the task’s folder, whatever the model decides to run</span></span>
            </label>
          )}
          {d.preApproved.includes('terminal') && <p className="hint warn">The model picks the commands. Only allow this for a folder you don’t mind it changing.</p>}
        </section>
      )}

      {saved && (
        <section className="panel">
          <div className="row gap">
            <span className="muted small flex">
              {saved.lastRun ? `Last run ${new Date(saved.lastRun).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'Hasn’t run yet'}
            </span>
            <button className="btn sm" onClick={() => { setTaskEnabled(saved.id, !saved.enabled); set({ enabled: !saved.enabled }); }}>{saved.enabled ? 'Turn off' : 'Turn on'}</button>
            <button className="btn danger sm" onClick={() => confirm(`Delete the task "${saved.name}"? Its chat stays.`) && onDelete()}><Trash2 size={13} /> Delete</button>
          </div>
        </section>
      )}
    </div>
  );
}
