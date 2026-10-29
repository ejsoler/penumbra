// Agents: a name, a purpose, a short persona, a model, and the skills and tools it may use. Every agent
// shares the model's full knowledge; the persona only shapes how it talks and works. Stored locally.
import { useSyncExternalStore } from 'react';
import { uid } from '../store';
import type { ToolGroup } from './builtins';

export { TOOL_GROUPS, type ToolGroup } from './builtins';

export interface Agent {
  id: string;
  name: string;
  /** Its purpose: what this agent is for, shown in lists and to the orchestrator. */
  description: string;
  /** A sentence or two on personality, communication style, and approach. */
  persona?: string;
  /** An emoji, or a small image as a data URL. Missing means initials. */
  avatar?: string;
  model: string;
  /** Optional extra rules, on top of the purpose and persona. */
  instructions: string;
  /** Skill ids this agent may load. Empty means all enabled skills. */
  skills: string[];
  tools: ToolGroup[];
  temperature?: number;
  createdAt: number;
  /** Set when the orchestrator created this agent. */
  createdBy?: 'orchestrator';
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
/** How long a persona should stay: a nudge for the model, not a system prompt. */
export const PERSONA_LIMIT = 300;

export const AGENT_TEMPLATES: Pick<Agent, 'name' | 'description' | 'persona' | 'instructions' | 'tools'>[] = [
  {
    name: 'Researcher',
    persona: 'Curious and skeptical. Checks claims before trusting them, separates facts from guesses, and explains findings in a calm, organized way.',
    description: 'Gathers facts and explains them clearly, with sources when it has them.',
    instructions: 'You are a careful researcher. Search the web for current or specific facts, read the most relevant pages, and answer with well-organized findings and the addresses you used. Say clearly when you are unsure, and never invent sources or numbers.',
    tools: ['skills', 'web'],
  },
  {
    name: 'Writer',
    persona: 'Warm and articulate. Listens for the tone you want, keeps sentences clear and natural, and cares about rhythm and word choice.',
    description: 'Drafts and edits text: emails, posts, summaries, documents.',
    instructions: 'You are a skilled writer and editor. Match the requested tone and length. Prefer clear, plain language. Return the finished text without commentary unless asked.',
    tools: ['skills'],
  },
  {
    name: 'Coder',
    persona: 'Pragmatic and precise. Reads before changing, prefers small, safe steps, and explains decisions briefly, like a thoughtful senior engineer.',
    description: 'Writes, explains, and reviews code.',
    instructions: "You are an expert programmer. Look at the existing files before changing anything, write correct, idiomatic code that matches the project's style, and test it when you can. Explain briefly what you changed.",
    tools: ['skills', 'files', 'write', 'terminal'],
  },
  {
    name: 'Analyst',
    persona: 'Methodical and clear. Thinks in numbers, shows the steps, and points out what the data does and doesn\'t say.',
    description: 'Works with numbers and data, and shows results as charts or calculators.',
    instructions: 'You are a data analyst. Work step by step, show your calculations, and present results visually when that helps.',
    tools: ['skills'],
  },
];
