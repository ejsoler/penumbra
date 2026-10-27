import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Agent } from '../agents/agents';
import { TOOL_GROUPS, type ToolGroup } from '../agents/builtins';
import { MAX_TASKS, type ModelInfo, type Orchestration, type Plan, type PlanTask } from '../agents/orchestrator';
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
}

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

export function PlanCard({ msgId, orch }: { msgId: string; orch: Orchestration }) {
  const actions = useContext(PlanActionsContext);
  const plan = orch.plan;
  const editable = orch.phase === 'review' && !!actions;
  const set = (patch: Partial<Plan>) => plan && actions?.change(msgId, { ...plan, ...patch });
  const setTask = (id: string, patch: Partial<PlanTask>) => plan && set({ tasks: plan.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const agentNames = [...(actions?.agents.map((a) => a.name) ?? []), ...(plan?.newAgents.map((a) => a.name) ?? [])];
  const chatModels = actions?.models.filter((m) => !m.capabilities.includes('embedding')) ?? [];
  const modelOf = (name: string) => plan?.newAgents.find((a) => a.name === name)?.model ?? actions?.agents.find((a) => a.name === name)?.model ?? '';
  const done = plan?.tasks.filter((t) => t.status === 'done').length ?? 0;

  return (
    <div className={`plan phase-${orch.phase}`}>
      <div className="plan-head">
        <Workflow size={15} />
        <b>Orchestrator plan</b>
        <span className={`plan-phase ${orch.phase}`}>
          {(orch.phase === 'planning' || orch.phase === 'running' || orch.phase === 'writing') && <Loader2 size={12} className="spin" />}
          {PHASE_LABEL[orch.phase]}
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

          {plan.newAgents.length > 0 && (
            <div className="plan-section">
              <div className="plan-label">New agents <span className="muted">· saved to your Agents tab when the plan runs</span></div>
              {plan.newAgents.map((a, i) => (
                <div key={i} className="plan-agent">
                  <div className="row gap">
                    <Bot size={14} className="accent" />
                    {editable ? (
                      <input
                        className="plan-input strong"
                        value={a.name}
                        onChange={(e) => {
                          const name = e.target.value;
                          set({
                            newAgents: plan.newAgents.map((x, j) => (j === i ? { ...x, name } : x)),
                            tasks: plan.tasks.map((t) => (t.agent === a.name ? { ...t, agent: name } : t)),
                          });
                        }}
                      />
                    ) : (
                      <b>{a.name}</b>
                    )}
                    {editable ? (
                      <select className="plan-select" value={a.model} onChange={(e) => set({ newAgents: plan.newAgents.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)) })}>
                        {chatModels.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                        {!chatModels.some((m) => m.name === a.model) && <option value={a.model}>{a.model}</option>}
                      </select>
                    ) : (
                      <span className="mono small muted">{a.model}</span>
                    )}
                  </div>
                  {a.description && <div className="muted small">{a.description}</div>}
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
                          onClick={() => set({ newAgents: plan.newAgents.map((x, j) => (j === i ? { ...x, tools: on ? x.tools.filter((t) => t !== g.id) : [...x.tools, g.id as ToolGroup] } : x)) })}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                  <Collapsible label="Instructions">
                    {editable ? (
                      <textarea className="plan-text" rows={4} value={a.instructions} onChange={(e) => set({ newAgents: plan.newAgents.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x)) })} />
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
                onRemove={() => set({ tasks: plan.tasks.filter((x) => x.id !== t.id).map((x) => ({ ...x, dependsOn: x.dependsOn.filter((d) => d !== t.id) })) })}
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
              <span className="muted small flex">Tasks run one at a time, in order. Tools still ask before risky actions.</span>
              <button className="btn sm" onClick={() => actions!.cancel(msgId)}><X size={13} /> Cancel</button>
              <button
                className="btn sm primary"
                disabled={actions!.busy || !plan.tasks.length || plan.tasks.some((t) => !t.instructions.trim() || !agentNames.includes(t.agent))}
                onClick={() => actions!.run(msgId)}
              >
                <Play size={13} /> Run plan
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
