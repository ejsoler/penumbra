// What the model gets for a reply: the system prompt and tools, built from the chat and its agent.
import { WIDGET_PROMPT } from '../widgets/prompt';
import type { Agent } from './agents';
import { builtinTools, toolsPrompt, type ToolGroup } from './builtins';
import { enabledSkills, skillsPrompt, skillTools } from './skills';
import type { Tool } from './tools';

export const DEFAULT_CHAT_TOOLS: ToolGroup[] = ['skills'];

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
  if (agent) parts.push(`You are "${agent.name}"${agent.description ? `: ${agent.description}` : '.'}\n\n${agent.instructions}`.trim());
  if (systemPrompt.trim()) parts.push(systemPrompt.trim());
  if (interactive) parts.push(WIDGET_PROMPT);
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
  return { system: parts.join('\n\n'), tools };
}
