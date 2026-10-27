// The orchestrator: one model plans (which agents, which models, which tasks), the user reviews the
// plan, then each task runs on its agent in dependency order and the orchestrator writes the answer.
import type * as api from '../api';
import type { Agent } from './agents';
import { TOOL_GROUPS, type ToolGroup } from './builtins';
import type { RunStats, Step } from './engine';

export const ORCHESTRATOR_ID = 'orchestrator';
export const MAX_TASKS = 8;

/** An agent the plan wants to create. */
export interface AgentDraft {
  name: string;
  description: string;
  model: string;
  instructions: string;
  tools: ToolGroup[];
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface PlanTask {
  id: string;
  title: string;
  /** Name of an existing agent or of one in newAgents. */
  agent: string;
  instructions: string;
  dependsOn: string[];
  // Filled in while running:
  status?: TaskStatus;
  output?: string;
  thinking?: string;
  steps?: Step[];
  model?: string;
  stats?: RunStats;
  error?: string;
}

export interface Plan {
  summary: string;
  newAgents: AgentDraft[];
  tasks: PlanTask[];
}

export type OrchestrationPhase = 'planning' | 'review' | 'running' | 'writing' | 'done' | 'cancelled' | 'error';

export interface Orchestration {
  goal: string;
  phase: OrchestrationPhase;
  plan?: Plan;
  /** What the planner said while planning (shown if it failed to make a plan). */
  plannerNote?: string;
  error?: string;
}

export interface ModelInfo {
  name: string;
  size?: string;
  capabilities: string[];
  loaded: boolean;
  remote: boolean;
}

// ---- planning --------------------------------------------------------------------------------------

const toolList = TOOL_GROUPS.map((g) => g.id);

export function planningPrompt({ agents, models, folder, toolsSupported }: {
  agents: Agent[];
  models: ModelInfo[];
  folder?: string;
  /** Whether the planner itself can call tools (else it must answer with JSON). */
  toolsSupported: boolean;
}): string {
  const agentLines = agents.length
    ? agents.map((a) => `- "${a.name}" (model ${a.model || 'none'}; tools: ${a.tools.join(', ') || 'none'}): ${a.description || a.instructions.slice(0, 160)}`).join('\n')
    : '(none yet)';
  const modelLines = models
    .map((m) => `- ${m.name}${m.size ? ` (${m.size})` : ''}: ${m.capabilities.filter((c) => c !== 'completion').join(', ') || 'text only'}${m.loaded ? ', already loaded' : ''}${m.remote ? ', cloud' : ''}`)
    .join('\n');
  return `You are the orchestrator in Penumbra, a desktop app for local AI models. Your job now is to PLAN, not to do the work: break the user's request into a few tasks and assign each task to an agent. After the user approves the plan, each agent does its task and you will write the final answer from their results.

## Existing agents
${agentLines}

## Installed models
${modelLines}

## Tools agents can have
${TOOL_GROUPS.map((g) => `- ${g.id}: ${g.description}`).join('\n')}
${folder ? `The chat folder for file and terminal tools is ${folder}.` : 'No chat folder is set, so do not plan tasks that need files or the terminal.'}

## How to plan
- Use as few tasks as the request needs (1 to ${MAX_TASKS}). A simple request may need just one task.
- Reuse existing agents when they fit. Create a new agent only for a role none of them covers.
- Each agent needs a model that supports "tools" if it has any tools. Prefer models that are already loaded, and reuse the same model across agents: switching models is slow on a home computer.
- Give each task clear, self-contained instructions: the agent sees only its instructions, the user's request, and the results of the tasks it depends on.
- Use depends_on when a task needs another task's result. Tasks run in order.
- Do not add a final "summarize" or "combine" task: you will write the final answer yourself.

${toolsSupported
  ? 'Call the propose_plan tool exactly once with the plan. Do not answer the request yourself.'
  : `Reply with only a JSON object, no other text, in this shape:
{"summary": "...", "new_agents": [{"name": "...", "description": "...", "model": "...", "instructions": "...", "tools": ["web"]}], "tasks": [{"id": "t1", "title": "...", "agent": "...", "instructions": "...", "depends_on": []}]}`}`;
}

export const PROPOSE_PLAN: api.ToolDefinition = {
  type: 'function',
  function: {
    name: 'propose_plan',
    description: 'Propose the plan for the user to review: new agents to create (if any) and the tasks to run.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One or two sentences: how you will approach the request' },
        new_agents: {
          type: 'array',
          description: 'Agents to create. Leave empty to only use existing agents.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string', description: 'What this agent is for' },
              model: { type: 'string', description: 'An installed model name' },
              instructions: { type: 'string', description: "The agent's system instructions" },
              tools: { type: 'array', items: { type: 'string', enum: toolList } },
            },
            required: ['name', 'model', 'instructions'],
          },
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Short id like t1' },
              title: { type: 'string', description: 'Short title' },
              agent: { type: 'string', description: 'Name of an existing agent or a new one' },
              instructions: { type: 'string', description: 'What the agent must do, self-contained' },
              depends_on: { type: 'array', items: { type: 'string' }, description: 'Ids of tasks whose results this task needs' },
            },
            required: ['id', 'title', 'agent', 'instructions'],
          },
        },
      },
      required: ['summary', 'tasks'],
    },
  },
};

const asArray = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v));

/** Turns the planner's tool arguments (or JSON reply) into a valid plan, repairing what it can. */
export function normalizePlan(raw: Record<string, unknown>, { agents, models, fallbackModel }: {
  agents: Agent[];
  models: ModelInfo[];
  fallbackModel: string;
}): Plan {
  const usable = models.filter((m) => !m.capabilities.includes('embedding'));
  const fixModel = (name: string, needsTools: boolean) => {
    const exact = usable.find((m) => m.name === name) ?? usable.find((m) => m.name.split(':')[0] === name.split(':')[0]);
    if (exact && (!needsTools || exact.capabilities.includes('tools'))) return exact.name;
    return fallbackModel;
  };
  const existing = new Set(agents.map((a) => a.name.toLowerCase()));
  const newAgents: AgentDraft[] = [];
  for (const item of asArray(raw.new_agents ?? raw.newAgents)) {
    const a = item as Record<string, unknown>;
    const name = s(a.name).slice(0, 60);
    if (!name || existing.has(name.toLowerCase()) || newAgents.some((n) => n.name.toLowerCase() === name.toLowerCase())) continue;
    const tools = asArray(a.tools).map(s).filter((t): t is ToolGroup => toolList.includes(t as ToolGroup));
    newAgents.push({ name, description: s(a.description), model: fixModel(s(a.model), tools.length > 0), instructions: s(a.instructions), tools });
  }
  const agentNames = [...agents.map((a) => a.name), ...newAgents.map((a) => a.name)];
  const findAgent = (name: string) => agentNames.find((n) => n.toLowerCase() === name.toLowerCase());
  const tasks: PlanTask[] = [];
  for (const item of asArray(raw.tasks).slice(0, MAX_TASKS)) {
    const t = item as Record<string, unknown>;
    const instructions = s(t.instructions);
    if (!instructions) continue;
    let agent = findAgent(s(t.agent));
    if (!agent) {
      // The planner named an agent it didn't define: create a plain one so the task can still run.
      agent = s(t.agent).slice(0, 60) || 'Helper';
      if (!findAgent(agent)) {
        newAgents.push({ name: agent, description: '', model: fallbackModel, instructions: `You are ${agent}. Do the task you are given carefully and report the result.`, tools: [] });
        agentNames.push(agent);
      }
    }
    const id = s(t.id).replace(/\s+/g, '') || `t${tasks.length + 1}`;
    tasks.push({ id: tasks.some((x) => x.id === id) ? `t${tasks.length + 1}` : id, title: s(t.title) || instructions.slice(0, 60), agent, instructions, dependsOn: asArray(t.depends_on ?? t.dependsOn).map(s) });
  }
  // Keep only dependencies on earlier tasks, so the order is always runnable.
  tasks.forEach((t, i) => (t.dependsOn = t.dependsOn.filter((d) => tasks.slice(0, i).some((p) => p.id === d))));
  // Drop new agents no task uses.
  const used = new Set(tasks.map((t) => t.agent.toLowerCase()));
  // Models sometimes leak JSON punctuation into the end of a string ("…conditions.\"}").
  const summary = s(raw.summary).replace(/["'}\]\s]+$/, '').replace(/^["'\s]+/, '');
  return { summary: /[.!?]$/.test(summary) || !summary ? summary : summary + '.', newAgents: newAgents.filter((a) => used.has(a.name.toLowerCase())), tasks };
}

/** Pulls a JSON object out of a reply (for models without tool calling). */
export function parsePlanText(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const v = JSON.parse(candidate);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// ---- running ---------------------------------------------------------------------------------------

const MAX_DEP_RESULT = 6000;

/** The prompt one task's agent gets: the user's request, the results it depends on, and its task. */
export function taskMessage(goal: string, task: PlanTask, tasks: PlanTask[]): string {
  const deps = task.dependsOn
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is PlanTask => !!t && t.status === 'done')
    .map((t) => `### Result of "${t.title}" (by ${t.agent})\n${(t.output ?? '').slice(0, MAX_DEP_RESULT)}`);
  return [
    `The user's request (for context): ${goal}`,
    deps.length ? `## Results from earlier tasks\n${deps.join('\n\n')}` : '',
    `## Your task: ${task.title}\n${task.instructions}\n\nDo only this task and reply with its result. Another agent will combine the results, so don't address the user's whole request.`,
  ].filter(Boolean).join('\n\n');
}

/** The prompt for the orchestrator's final answer. */
export function synthesisMessages(goal: string, plan: Plan, system: string): api.ChatMessage[] {
  const results = plan.tasks
    .map((t) => `### ${t.title} (by ${t.agent}${t.model ? `, ${t.model}` : ''}) — ${t.status}\n${t.status === 'done' ? (t.output ?? '').slice(0, 8000) : t.error || 'No result.'}`)
    .join('\n\n');
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${goal}\n\n---\nYour agents worked on this request. Their results:\n\n${results}\n\n---\nWrite the final answer to the request above for the user, using these results. Don't describe the process or the agents unless it helps; just answer well. If a task failed, work around it and say what is missing.`,
    },
  ];
}
