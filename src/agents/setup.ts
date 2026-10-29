// What the model gets for a reply: the system prompt and tools, built from the chat and its agent.
import { WIDGET_PROMPT } from '../widgets/prompt';
import type { Agent } from './agents';
import { builtinTools, toolsPrompt, type ToolGroup } from './builtins';
import { enabledSkills, skillsPrompt, skillTools } from './skills';
import type { Tool } from './tools';

export const DEFAULT_CHAT_TOOLS: ToolGroup[] = ['skills'];

/** Who the agent is. The persona changes its manner, never its knowledge or abilities. */
export function agentPrompt(agent: Agent): string {
  const lines = [`You are ${agent.name}.`];
  if (agent.description.trim()) lines.push(`Your purpose: ${agent.description.trim()}`);
  if (agent.persona?.trim()) {
    lines.push(
      `Your persona: ${agent.persona.trim()}`,
      'Let this persona shape how you communicate, reason through problems, and approach your role, and keep it for the whole conversation. It never limits what you know or can do: use your full general knowledge and all of your abilities, and stay accurate.',
    );
  }
  if (agent.instructions.trim()) lines.push('', agent.instructions.trim());
  return lines.join('\n');
}

export function replySetup({ agent, systemPrompt, interactive, toolsSupported, chatTools, folder }: {
  agent?: Agent;
  systemPrompt: string;
  interactive: boolean;
  /** The model supports tool calling (Ollama's "tools" capability). */
  toolsSupported: boolean;
  /** The chat's own tools, used when there is no agent. */
  chatTools?: ToolGroup[];
  folder?: string;
}): { system: string; tools: Tool[] } {
  const parts: string[] = [];
  const tools: Tool[] = [];
  if (agent) parts.push(agentPrompt(agent));
  if (systemPrompt.trim()) parts.push(systemPrompt.trim());
  if (toolsSupported) {
    const groups = agent ? agent.tools : chatTools ?? DEFAULT_CHAT_TOOLS;
    const env = { folder };
    tools.push(...builtinTools(groups, env));
    const prompt = toolsPrompt(groups, env);
    if (prompt) parts.push(prompt);
    if (groups.includes('skills')) {
      const list = enabledSkills(agent?.skills.length ? agent.skills : undefined);
      if (list.length) {
        parts.push(skillsPrompt(list));
        tools.push(...skillTools(list));
      }
    }
  }
  // Last, because it's long: the skills and tools rules above stay easy for the model to follow.
  if (interactive) parts.push(WIDGET_PROMPT);
  return { system: parts.join('\n\n'), tools };
}
