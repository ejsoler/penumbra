// A tool an agent (or a chat) can call through Ollama's tool calling.
import type { ToolDefinition } from '../api';

export type ToolArgs = Record<string, unknown>;

export interface ApprovalRequest {
  tool: string;
  title: string;
  /** What will happen, shown to the user verbatim (a command, a site…). */
  detail: string;
  /** Extra context under the detail, like the folder a command runs in. */
  note?: string;
  /** Label for an "always" choice (for example "Always allow this site"); omit for once-only actions. */
  always?: string;
  /** Label for the approve button. */
  confirm?: string;
  /** Label for "yes to every request like this until the run ends" (web only, never commands). */
  forRun?: string;
}

/** 'always' and 'run' only when the request offered them. */
export type Approval = boolean | 'always' | 'run';

export interface ToolContext {
  signal: AbortSignal;
  /** The user's latest message, for tools that check a call against it. */
  request?: string;
  /** Asks the user to allow an action. Resolves false if they decline or the run is stopped. */
  approve: (req: ApprovalRequest) => Promise<Approval>;
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

/** Thrown by a tool when the user says no; the message goes back to the model. */
export class Declined extends Error {}

export const toolDefinition = (t: Tool): ToolDefinition => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
});
