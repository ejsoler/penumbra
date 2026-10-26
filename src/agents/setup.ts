// What the model gets for a reply: the system prompt and tools, built from the chat and its agent.
import { WIDGET_PROMPT } from '../widgets/prompt';
import type { Agent } from './agents';
import { enabledSkills, skillsPrompt, skillTools } from './skills';
import type { Tool } from './tools';

export function replySetup({ agent, systemPrompt, interactive, toolsSupported }: {
  agent?: Agent;
  systemPrompt: string;
  interactive: boolean;
  /** The model supports tool calling (Ollama's "tools" capability). */
  toolsSupported: boolean;
}): { system: string; tools: Tool[] } {
  const parts: string[] = [];
  const tools: Tool[] = [];
  if (agent) parts.push(`You are "${agent.name}"${agent.description ? `: ${agent.description}` : '.'}\n\n${agent.instructions}`.trim());
  if (systemPrompt.trim()) parts.push(systemPrompt.trim());
  if (interactive) parts.push(WIDGET_PROMPT);
  const useSkills = agent ? agent.tools.includes('skills') : true;
  if (useSkills && toolsSupported) {
    const list = enabledSkills(agent?.skills.length ? agent.skills : undefined);
    if (list.length) {
      parts.push(skillsPrompt(list));
      tools.push(...skillTools(list));
    }
  }
  return { system: parts.join('\n\n'), tools };
}
