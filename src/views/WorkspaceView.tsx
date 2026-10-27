import { useMemo, useState } from 'react';
import type { OllamaState } from '../store';
import { usePersistent } from '../store';
import { useAgents } from '../agents/agents';
import { TOOL_GROUPS } from '../agents/builtins';
import type { Orchestration, PlanTask } from '../agents/orchestrator';
import { approval as approvalStore, chatController, getConversations, streaming, useConversations } from '../session';
import { host } from '../host';
import { Markdown } from '../components/Markdown';
import { PlanActionsContext, PlanCard, type PlanActions } from '../components/PlanCard';
import { Steps } from '../components/Steps';
import {
  Ban, Bot, CircleAlert, CircleCheck, FolderOpen, Loader2, MessageSquare, Plus, ShieldAlert, Square, Workflow, X,
} from '../components/icons';

interface Run {
  convId: string;
  convTitle: string;
  msgId: string;
  model: string;
  folder?: string;
  orch: Orchestration;
  answer: string;
  at: number;
}

const PHASE: Record<Orchestration['phase'], string> = {
  planning: 'Planning', review: 'Needs review', running: 'Running', writing: 'Writing answer', done: 'Done', cancelled: 'Cancelled', error: 'Failed',
};

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
};

export function WorkspaceView({ ollama, onOpenChat }: { ollama: OllamaState; onOpenChat: (convId: string) => void }) {
  const [conversations] = useConversations(() => ({ id: 'x', title: 'New Chat', model: '', systemPrompt: '', messages: [], updatedAt: Date.now() }));
  const [selected, setSelected] = usePersistent<string | null>('ollama-gui.workspaceRun', null);
  const streamingId = streaming.use();

  const runs = useMemo(() => {
    const list: Run[] = [];
    for (const c of conversations) {
      for (const m of c.messages) {
        if (m.orchestration) list.push({ convId: c.id, convTitle: c.title, msgId: m.id, model: m.model ?? c.model, folder: c.folder, orch: m.orchestration, answer: m.content, at: c.updatedAt });
      }
    }
    return list.reverse().sort((a, b) => b.at - a.at);
  }, [conversations]);

  const run = selected === 'new' ? null : runs.find((r) => r.msgId === selected) ?? null;
  const showNew = selected === 'new' || !run;

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="sidebar-title">Runs</span>
          <button className="icon-btn" onClick={() => setSelected('new')} title="New run"><Plus size={16} /></button>
        </div>
        <div className="conv-list">
          {runs.length === 0 && <p className="muted small pad">No runs yet. Start one, or pick Orchestrator in any chat.</p>}
          {runs.map((r) => (
            <div key={r.msgId} className={`conv-item ${r.msgId === run?.msgId ? 'active' : ''}`} onClick={() => setSelected(r.msgId)}>
              <div className="conv-text">
                <span className="conv-title">{r.orch.goal.replace(/<attached_file[\s\S]*?<\/attached_file>\s*/g, '').slice(0, 80)}</span>
                <span className="conv-sub">{PHASE[r.orch.phase]} · {ago(r.at)}</span>
              </div>
              {streamingId === r.convId && <span className="dot on pulse" />}
            </div>
          ))}
        </div>
      </aside>
      <main className="page workspace">
        {showNew ? <NewRun ollama={ollama} onStarted={(convId) => {
          // The run's message is created synchronously; select it once it shows up.
          const c = getConversations().find((x) => x.id === convId);
          setSelected(c?.messages.find((m) => m.orchestration)?.id ?? null);
        }} runs={runs} onPick={setSelected} /> : <RunView run={run!} ollama={ollama} onOpenChat={onOpenChat} />}
      </main>
    </>
  );
}

function NewRun({ ollama, onStarted, runs, onPick }: { ollama: OllamaState; onStarted: (convId: string) => void; runs: Run[]; onPick: (id: string) => void }) {
  const agents = useAgents();
  // Local models first: cloud models send the whole run to a remote server.
  const toolModels = ollama.models
    .filter((m) => (ollama.capabilities[m.name] ?? []).includes('tools'))
    .sort((a, b) => Number(!!a.remote_host) - Number(!!b.remote_host) || Number(!ollama.running.some((r) => r.name === b.name)) - Number(!ollama.running.some((r) => r.name === a.name)));
  const [model, setModel] = usePersistent('ollama-gui.workspaceModel', '');
  const [goal, setGoal] = useState('');
  const [folder, setFolder] = useState<string | undefined>();
  const busy = !!streaming.use();
  const planner = model && ollama.models.some((m) => m.name === model) ? model : toolModels[0]?.name ?? '';
  const start = () => {
    const id = chatController.current?.startOrchestration(goal, planner, folder);
    if (id) {
      setGoal('');
      // Wait a tick for the run's message to land in the store.
      setTimeout(() => onStarted(id), 0);
    }
  };
  return (
    <div className="editor">
      <header className="page-head">
        <div>
          <h1><Workflow size={20} className="accent" /> Orchestrator</h1>
          <p className="muted">Describe a goal. The orchestrator plans the work, creates agents if it needs them, and assigns them tasks. You review the plan before anything runs.</p>
        </div>
      </header>
      <section className="panel">
        <h4>Goal</h4>
        <textarea
          className="instructions"
          rows={5}
          value={goal}
          autoFocus
          placeholder="For example: Research the three best-rated budget laptops this year, compare them in a table, and write a short recommendation for a student."
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start();
          }}
        />
        <div className="new-run-opts">
          <label className="field slim column">
            <span>Planner model <small className="muted">plans and writes the final answer</small></span>
            <select className="wide-select" value={planner} onChange={(e) => setModel(e.target.value)}>
              {!toolModels.length && <option value="">No model with tool support installed</option>}
              {toolModels.map((m) => <option key={m.name} value={m.name}>{m.name}{m.details.parameter_size ? ` (${m.details.parameter_size})` : ''}{m.remote_host ? ' · cloud' : ''}</option>)}
            </select>
          </label>
          <div className="field slim column">
            <span>Folder <small className="muted">optional, for file and terminal tools</small></span>
            <div className="row gap">
              {folder ? (
                <>
                  <span className="mono small folder-path" title={folder}>{folder}</span>
                  <button className="icon-btn sm" title="Remove folder" onClick={() => setFolder(undefined)}><X size={12} /></button>
                </>
              ) : (
                <button className="btn sm" disabled={!host()} onClick={async () => setFolder((await host()?.tools.pickFolder()) ?? undefined)}><FolderOpen size={13} /> Choose…</button>
              )}
            </div>
          </div>
        </div>
        <div className="row gap new-run-actions">
          <span className="muted small flex">{agents.length ? `Agents it can use: ${agents.map((a) => a.name).join(', ')}` : 'No agents yet; it will create the ones it needs.'}</span>
          <button className="btn primary" disabled={!goal.trim() || !planner || busy} onClick={start} title={busy ? 'Another reply is running' : `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter`}>
            <Workflow size={14} /> Make a plan
          </button>
        </div>
      </section>
      {runs.length > 0 && (
        <section className="panel">
          <h4>Recent runs</h4>
          {runs.slice(0, 5).map((r) => (
            <button key={r.msgId} className="recent-run" onClick={() => onPick(r.msgId)}>
              <span className="flex">{r.orch.goal.slice(0, 120)}</span>
              <span className={`plan-phase ${r.orch.phase}`}>{PHASE[r.orch.phase]}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function RunView({ run, ollama, onOpenChat }: { run: Run; ollama: OllamaState; onOpenChat: (convId: string) => void }) {
  const agents = useAgents();
  const streamingId = streaming.use();
  const pending = approvalStore.use();
  const live = streamingId === run.convId;
  const plan = run.orch.plan;
  const c = chatController.current;
  const actions: PlanActions = {
    agents,
    models: ollama.models.map((m) => ({ name: m.name, size: m.details.parameter_size, capabilities: ollama.capabilities[m.name] ?? [], loaded: ollama.running.some((r) => r.name === m.name), remote: !!m.remote_host })),
    busy: !!streamingId,
    change: (msgId, p) => c?.changePlan(run.convId, msgId, p),
    run: (msgId) => c?.runPlan(msgId),
    cancel: (msgId) => c?.cancelPlan(run.convId, msgId),
  };

  // One lane per agent, in the order the plan first uses them.
  const lanes = useMemo(() => {
    const order: string[] = [];
    for (const t of plan?.tasks ?? []) if (!order.includes(t.agent)) order.push(t.agent);
    return order.map((name) => {
      const draft = plan?.newAgents.find((a) => a.name === name);
      const saved = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
      return {
        name,
        model: saved?.model ?? draft?.model ?? '',
        tools: saved?.tools ?? draft?.tools ?? [],
        created: !!draft || saved?.createdBy === 'orchestrator',
        tasks: (plan?.tasks ?? []).filter((t) => t.agent === name),
      };
    });
  }, [plan, agents]);

  const showBoard = plan && ['running', 'writing', 'done'].includes(run.orch.phase) || (run.orch.phase === 'cancelled' && plan?.tasks.some((t) => t.status));

  return (
    <div className="run">
      <header className="page-head">
        <div className="run-title">
          <h1 title={run.orch.goal}>{run.orch.goal.replace(/<attached_file[\s\S]*?<\/attached_file>\s*/g, '')}</h1>
          <p className="muted small">
            <span className={`plan-phase ${run.orch.phase}`}>{live && <Loader2 size={11} className="spin" />}{PHASE[run.orch.phase]}</span>
            {' '}Planner <span className="mono">{run.model}</span>
            {run.folder && <> · folder <span className="mono">{run.folder.split(/[\\/]/).slice(-2).join('/')}</span></>}
            {' '}· chat “{run.convTitle}”
          </p>
        </div>
        <div className="row gap">
          {live && <button className="btn sm" onClick={() => c?.stop()}><Square size={12} fill="currentColor" /> Stop</button>}
          <button className="btn sm" onClick={() => onOpenChat(run.convId)}><MessageSquare size={13} /> Open in chat</button>
        </div>
      </header>

      {pending && pending.convId === run.convId && (
        <div className="approval inline">
          <div className="approval-head"><ShieldAlert size={15} /> {pending.req.title}</div>
          <pre className="approval-detail">{pending.req.detail}</pre>
          {pending.req.note && <div className="approval-note muted small">{pending.req.note}</div>}
          <div className="row gap approval-actions">
            <button className="btn sm" onClick={() => pending.resolve(false)}>Don't allow</button>
            <span className="flex" />
            {pending.req.forRun && <button className="btn sm" onClick={() => pending.resolve('run')}>{pending.req.forRun}</button>}
            {pending.req.always && <button className="btn sm" onClick={() => pending.resolve('always')}>{pending.req.always}</button>}
            <button className="btn sm primary" autoFocus onClick={() => pending.resolve(true)}>{pending.req.confirm ?? 'Allow'}</button>
          </div>
        </div>
      )}

      {showBoard ? (
        <>
          {plan?.summary && <p className="plan-summary">{plan.summary}</p>}
          <div className="board">
            {lanes.map((lane) => (
              <div key={lane.name} className="lane">
                <div className="lane-head">
                  <div className="row gap"><Bot size={14} className="accent" /><b className="flex">{lane.name}</b>{lane.created && <span className="badge label" title="Created by the orchestrator">new</span>}</div>
                  <div className="mono small muted">{lane.model}</div>
                  {lane.tools.length > 0 && <div className="plan-tools">{lane.tools.map((t) => <span key={t} className="tool-chip on">{TOOL_GROUPS.find((g) => g.id === t)?.label ?? t}</span>)}</div>}
                </div>
                {lane.tasks.map((t) => <TaskCard key={t.id} task={t} index={plan!.tasks.indexOf(t)} />)}
              </div>
            ))}
          </div>
          {(run.answer || run.orch.phase === 'writing') && (
            <section className="panel final">
              <h4>{run.orch.phase === 'writing' ? <><Loader2 size={12} className="spin" /> Writing the final answer…</> : 'Final answer'}</h4>
              <Markdown text={run.answer} live={run.orch.phase === 'writing'} />
            </section>
          )}
        </>
      ) : (
        <PlanActionsContext.Provider value={actions}>
          <PlanCard msgId={run.msgId} orch={run.orch} />
        </PlanActionsContext.Provider>
      )}
    </div>
  );
}

function TaskCard({ task, index }: { task: PlanTask; index: number }) {
  const [open, setOpen] = useState(false);
  const status = task.status ?? 'pending';
  const Icon = status === 'running' ? Loader2 : status === 'done' ? CircleCheck : status === 'error' ? CircleAlert : status === 'skipped' ? Ban : null;
  const long = (task.output?.length ?? 0) > 600;
  return (
    <div className={`task-card ${status}`}>
      <div className="row gap">
        <span className="task-num">{Icon ? <Icon size={13} className={status === 'running' ? 'spin' : ''} /> : index + 1}</span>
        <b className="flex task-card-title">{task.title}</b>
        <span className="muted small">{status}</span>
      </div>
      {task.dependsOn.length > 0 && <div className="muted small">After {task.dependsOn.join(', ')}</div>}
      {status === 'pending' && <div className="plan-instr muted small">{task.instructions}</div>}
      {task.steps?.length ? <Steps steps={task.steps} /> : null}
      {task.output && (
        <div className={`task-card-output ${open || !long ? 'open' : ''}`}>
          <Markdown text={task.output} live={status === 'running'} />
        </div>
      )}
      {long && <button className="link-btn small" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show all'}</button>}
      {status === 'running' && !task.output && <span className="typing"><i /><i /><i /></span>}
      {task.error && <div className="msg-error">⚠ {task.error}</div>}
      {task.stats && <div className="stats mono">{task.stats.tokens} tokens · {task.stats.seconds.toFixed(1)} s</div>}
    </div>
  );
}
