import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Agent } from '../agents/agents';
import { TOOL_GROUPS, type ToolGroup } from '../agents/builtins';
import { MAX_TASKS, type AgentDraft, type ModelInfo, type Orchestration, type Plan, type PlanTask } from '../agents/orchestrator';
import { Markdown } from './Markdown';
import { Steps } from './Steps';
import {
  Ban, Bot, ChevronRight, CircleAlert, CircleCheck, Loader2, Play, Plus, Trash2, Workflow, X,
} from './icons';

/** What a plan card can ask the chat to do. Provided by the chat view. */
export interface PlanActions {
  agents: Agent[];
  models: ModelInfo[];
  busy: boolean;
  change: (msgId: string, plan: Plan) => void;
  run: (msgId: string) => void;
  cancel: (msgId: string) => void;
  /** Lets the goal be edited too (when editing a run that already exists). */
  changeGoal?: (msgId: string, goal: string) => void;
}

/** Editing a run that already exists: what to do instead of the first review's Cancel. */
export interface PlanEdit {
  onCancel: () => void;
  onSave: () => void;
}

/** A task whose instructions, agent, or inputs change runs again; its results so far are kept as an earlier result. */
const RESET: Partial<PlanTask> = { edited: true };
const resets = (patch: Partial<PlanTask>) => ('instructions' in patch || 'agent' in patch || 'dependsOn' in patch ? RESET : {});

export const PlanActionsContext = createContext<PlanActions | null>(null);

const PHASE_LABEL: Record<Orchestration['phase'], string> = {
  planning: 'Planning…',
  review: 'Review the plan',
  running: 'Running',
  writing: 'Writing the answer…',
  done: 'Done',
  cancelled: 'Cancelled',
  error: "Couldn't make a plan",
};

export function PlanCard({ msgId, orch, edit }: { msgId: string; orch: Orchestration; edit?: PlanEdit }) {
  const actions = useContext(PlanActionsContext);
  const plan = orch.plan;
  const editable = (orch.phase === 'review' || !!edit) && !!actions;
  const set = (patch: Partial<Plan>) => plan && actions?.change(msgId, { ...plan, ...patch });
  const setTask = (id: string, patch: Partial<PlanTask>) => plan && set({ tasks: plan.tasks.map((t) => (t.id === id ? { ...t, ...patch, ...resets(patch) } : t)) });
  /** Changes a new agent; the tasks it does run again. */
  const setAgent = (i: number, patch: Partial<AgentDraft>) => {
    if (!plan) return;
    const name = plan.newAgents[i].name;
    set({
      newAgents: plan.newAgents.map((x, j) => (j === i ? { ...x, ...patch } : x)),
      tasks: plan.tasks.map((t) => (t.agent === name ? { ...t, ...RESET, ...('name' in patch ? { agent: patch.name! } : {}) } : t)),
    });
  };
  const addAgent = () => {
    if (!plan) return;
    let n = 1;
    while ([...agentNames].some((x) => x.toLowerCase() === (n === 1 ? 'new agent' : `new agent ${n}`))) n++;
    const model = chatModels.find((m) => m.capabilities.includes('tools') && !m.remote)?.name ?? chatModels[0]?.name ?? '';
    set({ newAgents: [...plan.newAgents, { name: n === 1 ? 'New agent' : `New agent ${n}`, description: '', model, instructions: '', tools: [] }] });
  };
  const agentNames = [...(actions?.agents.map((a) => a.name) ?? []), ...(plan?.newAgents.map((a) => a.name) ?? [])];
  const chatModels = actions?.models.filter((m) => !m.capabilities.includes('embedding')) ?? [];
  const modelOf = (name: string) => plan?.newAgents.find((a) => a.name === name)?.model ?? actions?.agents.find((a) => a.name === name)?.model ?? '';
  const done = plan?.tasks.filter((t) => t.status === 'done').length ?? 0;
  const valid = !!plan && plan.tasks.length > 0 && plan.tasks.every((t) => t.instructions.trim() && agentNames.includes(t.agent)) && plan.newAgents.every((a) => a.name.trim() && a.model && a.instructions.trim());

  return (
    <div className={`plan phase-${orch.phase}`}>
      <div className="plan-head">
        <Workflow size={15} />
        <b>Orchestrator plan</b>
        <span className={`plan-phase ${orch.phase}`}>
          {(orch.phase === 'planning' || orch.phase === 'running' || orch.phase === 'writing') && <Loader2 size={12} className="spin" />}
          {edit ? 'Edit the plan' : PHASE_LABEL[orch.phase]}
          {orch.phase === 'running' && plan && ` · ${done}/${plan.tasks.length}`}
        </span>
      </div>

      {orch.phase === 'error' && (
        <div className="plan-error">
          {orch.error}
          {orch.plannerNote && <details><summary>What the model said</summary><Markdown text={orch.plannerNote} /></details>}
        </div>
      )}

      {plan && (
        <>
          {plan.summary && <p className="plan-summary">{plan.summary}</p>}

          {editable && actions?.changeGoal && (
            <div className="plan-section">
              <div className="plan-label">Goal <span className="muted">· the request every agent works from; changing it runs every task again, keeping what they made before</span></div>
              <textarea className="plan-text" rows={3} value={orch.goal} onChange={(e) => actions.changeGoal!(msgId, e.target.value)} />
            </div>
          )}

          {(plan.newAgents.length > 0 || editable) && (
            <div className="plan-section">
              <div className="plan-label">
                New agents <span className="muted">· saved to your Agents tab when the plan runs</span>
                {editable && <button className="btn sm ghost" onClick={addAgent}><Plus size={13} /> Add agent</button>}
              </div>
              {plan.newAgents.map((a, i) => (
                <div key={i} className="plan-agent">
                  <div className="row gap">
                    <Bot size={14} className="accent" />
                    {editable ? (
                      <input
                        className="plan-input strong"
                        value={a.name}
                        onChange={(e) => setAgent(i, { name: e.target.value })}
                      />
                    ) : (
                      <b>{a.name}</b>
                    )}
                    {editable && !plan.tasks.some((t) => t.agent === a.name) && (
                      <button className="icon-btn sm" title="Remove agent" onClick={() => set({ newAgents: plan.newAgents.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                    )}
                    {editable ? (
                      <select className="plan-select" value={a.model} onChange={(e) => setAgent(i, { model: e.target.value })}>
                        {chatModels.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                        {!chatModels.some((m) => m.name === a.model) && <option value={a.model}>{a.model}</option>}
                      </select>
                    ) : (
                      <span className="mono small muted">{a.model}</span>
                    )}
                  </div>
                  {editable ? (
                    <input className="plan-input" value={a.description} placeholder="What is this agent for?" onChange={(e) => setAgent(i, { description: e.target.value })} />
                  ) : (
                    a.description && <div className="muted small">{a.description}</div>
                  )}
                  <div className="plan-tools">
                    {TOOL_GROUPS.map((g) => {
                      const on = a.tools.includes(g.id);
                      if (!editable && !on) return null;
                      return (
                        <button
                          key={g.id}
                          className={`tool-chip ${on ? 'on' : ''}`}
                          disabled={!editable}
                          title={g.description}
                          onClick={() => setAgent(i, { tools: on ? a.tools.filter((t) => t !== g.id) : [...a.tools, g.id as ToolGroup] })}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                  <Collapsible label="Instructions">
                    {editable ? (
                      <textarea className="plan-text" rows={4} value={a.instructions} onChange={(e) => setAgent(i, { instructions: e.target.value })} />
                    ) : (
                      <div className="plan-instr">{a.instructions}</div>
                    )}
                  </Collapsible>
                </div>
              ))}
            </div>
          )}

          <div className="plan-section">
            <div className="plan-label">Tasks</div>
            {plan.tasks.map((t, i) => (
              <TaskRow
                key={t.id}
                index={i}
                task={t}
                editable={editable}
                agentNames={agentNames}
                model={t.model || modelOf(t.agent)}
                onChange={(patch) => setTask(t.id, patch)}
                onRemove={() => set({ tasks: plan.tasks.filter((x) => x.id !== t.id).map((x) => (x.dependsOn.includes(t.id) ? { ...x, ...RESET, dependsOn: x.dependsOn.filter((d) => d !== t.id) } : x)) })}
              />
            ))}
            {editable && plan.tasks.length < MAX_TASKS && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  const id = `t${Math.max(0, ...plan.tasks.map((t) => Number(t.id.replace(/\D/g, '')) || 0)) + 1}`;
                  set({ tasks: [...plan.tasks, { id, title: 'New task', agent: agentNames[0] ?? '', instructions: '', dependsOn: [] }] });
                }}
              >
                <Plus size={13} /> Add task
              </button>
            )}
          </div>

          {editable && (
            <div className="plan-actions row gap">
              <span className="muted small flex">
                {edit ? 'Tasks you leave alone keep their results; changed ones, and those that use them, run again, and nothing from before is deleted.' : 'Tasks run one at a time, in order. Tools still ask before risky actions.'}
              </span>
              <button className="btn sm" onClick={() => (edit ? edit.onCancel() : actions!.cancel(msgId))}><X size={13} /> Cancel</button>
              {edit && <button className="btn sm" disabled={!valid} onClick={edit.onSave}>Save</button>}
              <button className="btn sm primary" disabled={actions!.busy || !valid} onClick={() => actions!.run(msgId)}>
                <Play size={13} /> {edit ? 'Save and run' : 'Run plan'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TaskRow({ index, task, editable, agentNames, model, onChange, onRemove }: {
  index: number;
  task: PlanTask;
  editable: boolean;
  agentNames: string[];
  model: string;
  onChange: (patch: Partial<PlanTask>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = task.status ?? 'pending';
  const Icon = status === 'running' ? Loader2 : status === 'done' ? CircleCheck : status === 'error' ? CircleAlert : status === 'skipped' ? Ban : null;
  const hasOutput = !!(task.output || task.steps?.length || task.error);
  const expanded = open || status === 'running';
  return (
    <div className={`plan-task ${status}`}>
      <div className="plan-task-head">
        <span className="task-num">{Icon ? <Icon size={14} className={status === 'running' ? 'spin' : ''} /> : index + 1}</span>
        {editable ? (
          <input className="plan-input strong flex" value={task.title} onChange={(e) => onChange({ title: e.target.value })} />
        ) : (
          <button className="task-title flex" onClick={() => setOpen(!open)} disabled={!hasOutput}>
            <b>{task.title}</b>
            {hasOutput && <ChevronRight size={13} className={`chev ${expanded ? 'open' : ''}`} />}
          </button>
        )}
        {editable ? (
          <select className={`plan-select ${agentNames.includes(task.agent) ? '' : 'bad'}`} value={task.agent} onChange={(e) => onChange({ agent: e.target.value })}>
            {!agentNames.includes(task.agent) && <option value={task.agent}>{task.agent || 'Choose an agent'}</option>}
            {agentNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          <span className="task-agent"><Bot size={12} /> {task.agent}</span>
        )}
        <span className="mono small muted task-model" title={model}>{model}</span>
        {editable && <button className="icon-btn sm" title="Remove task" onClick={onRemove}><Trash2 size={13} /></button>}
      </div>
      {task.dependsOn.length > 0 && <div className="task-deps muted small">Uses the result of {task.dependsOn.join(', ')}</div>}
      {editable && task.edited && task.output && <div className="task-deps muted small">Edited: it runs again, and its current result is kept under Earlier results.</div>}
      {editable ? (
        <textarea className="plan-text" rows={3} value={task.instructions} placeholder="What should this agent do?" onChange={(e) => onChange({ instructions: e.target.value })} />
      ) : (
        !expanded && status === 'pending' && <div className="plan-instr muted small">{task.instructions}</div>
      )}
      {!editable && expanded && (
        <div className="task-output">
          <div className="plan-instr muted small">{task.instructions}</div>
          {task.steps?.length ? <Steps steps={task.steps} /> : null}
          {task.output && <Markdown text={task.output} live={status === 'running'} />}
          {status === 'running' && !task.output && !task.steps?.some((s) => s.status === 'running') && <span className="typing"><i /><i /><i /></span>}
          {task.error && <div className="msg-error">⚠ {task.error}</div>}
          {task.stats && <div className="stats mono">{task.stats.tps.toFixed(1)} tok/s · {task.stats.tokens} tokens · {task.stats.seconds.toFixed(1)} s</div>}
        </div>
      )}
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="collapsible">
      <button className="link-btn small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} {label.toLowerCase()}</button>
      {open && children}
    </div>
  );
}
