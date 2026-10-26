// The agent loop: ask the model, run the tools it calls, give it the results, repeat until it answers
// without calling a tool. Used by chats (with or without an agent) and by the orchestrator.
import * as api from '../api';
import { toolDefinition, type ApprovalRequest, type Tool } from './tools';

export interface Step {
  id: string;
  tool: string;
  label: string;
  summary: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: string;
  /** Length of the reply text when the step ran, so the timeline shows it in place. */
  at: number;
}

export interface RunStats {
  tokens: number;
  tps: number;
  ttft: number;
  promptTokens: number;
  seconds: number;
}

export interface RunOptions {
  model: string;
  messages: api.ChatMessage[];
  tools?: Tool[];
  options?: Record<string, number>;
  think?: boolean;
  keepAlive?: string;
  signal: AbortSignal;
  /** Tool-call rounds before the run is cut off. */
  maxSteps?: number;
  onText?: (piece: string) => void;
  onThinking?: (piece: string) => void;
  /** Called when a step starts and again when it finishes (same id). */
  onStep?: (step: Step) => void;
  approve?: (req: ApprovalRequest) => Promise<boolean>;
}

export interface RunResult {
  content: string;
  stats: RunStats;
  /** True if the run hit maxSteps before the model gave a final answer. */
  cutOff: boolean;
}

/** Tool results go back into the model's context, so keep them bounded. */
const MAX_RESULT = 16000;
const clip = (s: string) => (s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}\n\n[…truncated, ${s.length - MAX_RESULT} more characters]` : s);

let stepSeq = 0;

export async function runAgent(o: RunOptions): Promise<RunResult> {
  const tools = o.tools ?? [];
  const defs = tools.map(toolDefinition);
  const history = [...o.messages];
  const start = performance.now();
  const stats: RunStats = { tokens: 0, tps: 0, ttft: 0, promptTokens: 0, seconds: 0 };
  let evalSeconds = 0;
  let content = '';
  const maxSteps = o.maxSteps ?? 12;

  for (let round = 0; ; round++) {
    let text = '';
    let thinking = '';
    const calls: api.ToolCall[] = [];
    const stream = api.chat(
      {
        model: o.model,
        messages: history,
        options: o.options,
        keep_alive: o.keepAlive,
        ...(o.think !== undefined ? { think: o.think } : {}),
        // On the last allowed round, take tools away so the model has to answer.
        ...(defs.length && round < maxSteps ? { tools: defs } : {}),
      },
      o.signal,
    );
    for await (const chunk of stream) {
      const piece = chunk.message?.content ?? '';
      const thought = chunk.message?.thinking ?? '';
      if ((piece || thought) && !stats.ttft) stats.ttft = (performance.now() - start) / 1000;
      if (piece) {
        // Separate text written before and after tool calls.
        if (!text && content && !content.endsWith('\n\n')) {
          content += '\n\n';
          o.onText?.('\n\n');
        }
        text += piece;
        content += piece;
        o.onText?.(piece);
      }
      if (thought) {
        thinking += thought;
        o.onThinking?.(thought);
      }
      if (chunk.message?.tool_calls?.length) calls.push(...chunk.message.tool_calls);
      if (chunk.done) {
        stats.tokens += chunk.eval_count ?? 0;
        evalSeconds += (chunk.eval_duration ?? 0) / 1e9;
        stats.promptTokens = (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0);
      }
    }
    history.push({ role: 'assistant', content: text, ...(thinking ? { thinking } : {}), ...(calls.length ? { tool_calls: calls } : {}) });

    if (!calls.length || round >= maxSteps) {
      stats.tps = evalSeconds ? stats.tokens / evalSeconds : 0;
      stats.seconds = (performance.now() - start) / 1000;
      return { content, stats, cutOff: calls.length > 0 };
    }

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.function.name);
      const args = (call.function.arguments ?? {}) as Record<string, unknown>;
      const step: Step = {
        id: `s${++stepSeq}`,
        tool: call.function.name,
        label: tool?.label ?? call.function.name,
        summary: tool?.summary?.(args) ?? '',
        args,
        status: 'running',
        at: content.length,
      };
      o.onStep?.(step);
      let result: string;
      let status: Step['status'] = 'done';
      if (!tool) {
        result = `Error: there is no tool named "${call.function.name}". Available tools: ${tools.map((t) => t.name).join(', ')}`;
        status = 'error';
      } else {
        try {
          result = await tool.run(args, { signal: o.signal, approve: o.approve ?? (async () => false) });
        } catch (e) {
          if (o.signal.aborted) throw e;
          result = `Error: ${(e as Error).message}`;
          status = 'error';
        }
      }
      result = clip(result);
      o.onStep?.({ ...step, status, result });
      history.push({ role: 'tool', content: result, tool_name: call.function.name });
    }
  }
}
