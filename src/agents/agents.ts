// Agents: a name, a model, instructions, and the skills and tools it may use. Stored locally.
import { useSyncExternalStore } from 'react';
import { uid } from '../store';

/** Tools an agent can be given. Interactive widgets follow the chat's Interactive switch instead. */
export type ToolGroup = 'skills';

export const TOOL_GROUPS: { id: ToolGroup; label: string; description: string }[] = [
  { id: 'skills', label: 'Skills', description: 'Load the skills selected below when a task matches them' },
];

export interface Agent {
  id: string;
  name: string;
  /** What this agent is for, shown in lists and to the orchestrator. */
  description: string;
  model: string;
  instructions: string;
  /** Skill ids this agent may load. Empty means all enabled skills. */
  skills: string[];
  tools: ToolGroup[];
  temperature?: number;
  createdAt: number;
}

const KEY = 'ollama-gui.agents';
let agents: Agent[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

function save(next: Agent[]) {
  agents = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export const useAgents = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => agents,
  );

export const getAgent = (id?: string) => agents.find((a) => a.id === id);

export function createAgent(fields: Partial<Agent> = {}): Agent {
  const a: Agent = {
    id: uid(),
    name: 'New agent',
    description: '',
    model: '',
    instructions: '',
    skills: [],
    tools: ['skills'],
    createdAt: Date.now(),
    ...fields,
  };
  save([...agents, a]);
  return a;
}

export const updateAgent = (id: string, patch: Partial<Agent>) => save(agents.map((a) => (a.id === id ? { ...a, ...patch } : a)));
export const deleteAgent = (id: string) => save(agents.filter((a) => a.id !== id));
export function duplicateAgent(a: Agent): Agent {
  const { id: _id, ...fields } = a;
  return createAgent({ ...fields, name: `${a.name} (copy)`, createdAt: Date.now() });
}

/** Starting points for new agents. */
export const AGENT_TEMPLATES: Pick<Agent, 'name' | 'description' | 'instructions' | 'tools'>[] = [
  {
    name: 'Researcher',
    description: 'Gathers facts and explains them clearly, with sources when it has them.',
    instructions: 'You are a careful researcher. Answer with well-organized facts. Say clearly when you are unsure, and never invent sources or numbers.',
    tools: ['skills'],
  },
  {
    name: 'Writer',
    description: 'Drafts and edits text: emails, posts, summaries, documents.',
    instructions: 'You are a skilled writer and editor. Match the requested tone and length. Prefer clear, plain language. Return the finished text without commentary unless asked.',
    tools: ['skills'],
  },
  {
    name: 'Coder',
    description: 'Writes, explains, and reviews code.',
    instructions: 'You are an expert programmer. Write correct, idiomatic, well-structured code. Explain briefly what the code does and any assumptions.',
    tools: ['skills'],
  },
  {
    name: 'Analyst',
    description: 'Works with numbers and data, and shows results as charts or calculators.',
    instructions: 'You are a data analyst. Work step by step, show your calculations, and present results visually when that helps.',
    tools: ['skills'],
  },
];
