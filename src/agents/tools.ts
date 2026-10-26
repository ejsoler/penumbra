// A tool an agent (or a chat) can call through Ollama's tool calling.
import type { ToolDefinition } from '../api';

export type ToolArgs = Record<string, unknown>;

export interface ApprovalRequest {
  tool: string;
  title: string;
  /** What will happen, shown to the user verbatim (a command, a file path…). */
  detail: string;
}

export interface ToolContext {
  signal: AbortSignal;
  /** Asks the user to allow an action. Resolves false if they decline or the run is stopped. */
  approve: (req: ApprovalRequest) => Promise<boolean>;
}

export interface Tool {
  name: string;
  /** Short human name for the timeline ("Load skill"). */
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  /** One-line summary of a call for the timeline. */
  summary?: (args: ToolArgs) => string;
  run: (args: ToolArgs, ctx: ToolContext) => Promise<string>;
}

export const toolDefinition = (t: Tool): ToolDefinition => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
});
