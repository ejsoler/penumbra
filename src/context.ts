// Keeping long chats inside the model's context window. Before each reply, older messages are sent in a
// shorter form (widget code, attached files, and images are replaced by short notes; the chat on screen
// doesn't change). When even that won't fit, the older part of the chat is summarized by the model, and
// from then on the summary is sent in place of those messages.
import * as api from './api';
import type { Conversation, UiMessage } from './store';
import { widgetTitle } from './widgets/document';

/** The last few messages always go whole, so the model can work with the latest widget or file. */
const RECENT = 4;
/** Rough tokens for text and images. Erring high keeps replies from being squeezed. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.2);
const IMAGE_TOKENS = 800;

/** The older part of a chat, summarized. Messages up to `upTo` are replaced by `text` when sending. */
export interface ChatSummary {
  text: string;
  upTo: string;
  /** How many messages it covers. */
  count: number;
  at: number;
  /** For the context meter: the estimated size right after summarizing, until the next reply measures it. */
  estimate?: number;
  /** The message whose stats the meter showed when this summary was made. */
  statsMsg?: string;
}

const MAX_ATTACHED_TOTAL = 60000;
const OLD_FILE_PREVIEW = 1500;

/** A message's text as the model gets it: attached files go in first, capped so they can't flood the context. */
export function withFiles(m: UiMessage, old = false): string {
  if (!m.files?.length) return m.content;
  let room = old ? OLD_FILE_PREVIEW : MAX_ATTACHED_TOTAL;
  const blocks = m.files.map((f) => {
    const cut = f.text.length > room;
    const text = cut
      ? `${f.text.slice(0, Math.max(0, room))}\n[…${old ? 'the rest was sent earlier and is left out to save space' : 'cut'}: the file has ${f.text.length.toLocaleString()} characters]`
      : f.text;
    room -= Math.min(room, f.text.length);
    return `<attached_file name="${f.name.replace(/"/g, "'")}">\n${text}\n</attached_file>`;
  });
  return `${blocks.join('\n\n')}\n\n${m.content}`;
}

const WIDGET_BLOCK = /```widget[^\n]*\n([\s\S]*?)(?:```|$)/g;
/** Older replies keep a note of each widget instead of its code. */
const shrinkWidgets = (text: string) => text.replace(WIDGET_BLOCK, (_m, code: string) => `[An interactive widget was shown here: "${widgetTitle(code)}"]`);

/** One message as it's sent: whole if recent, shortened if older. */
function toApi(m: UiMessage, old: boolean): api.ChatMessage {
  if (m.role === 'assistant') return { role: 'assistant', content: old ? shrinkWidgets(m.content) : m.content };
  const images = old ? [] : m.images ?? [];
  const content = withFiles(m, old) + (old && m.images?.length ? `\n[${m.images.length === 1 ? 'An image was' : `${m.images.length} images were`} attached here]` : '');
  return { role: 'user', content, ...(images.length ? { images } : {}) };
}

/** Where the summary stops, if it still applies to this history (edits and branches can drop its last message). */
function summaryEnd(history: UiMessage[], summary?: ChatSummary) {
  if (!summary) return 0;
  const i = history.findIndex((m) => m.id === summary.upTo);
  return i >= 0 && i < history.length - 1 ? i + 1 : 0;
}

/** The chat as the model receives it: the summary (if any), then the rest, older messages shortened. */
export function chatMessages(history: UiMessage[], summary?: ChatSummary): api.ChatMessage[] {
  const start = summaryEnd(history, summary);
  const rest = history.slice(start).filter((m) => !m.error || m.content);
  const out = rest.map((m, i) => toApi(m, i < rest.length - RECENT));
  if (start && summary) {
    out.unshift({ role: 'system', content: `Summary of the earlier part of this conversation (those messages are no longer shown to you):\n\n${summary.text}` });
  }
  return out;
}

export const messagesTokens = (messages: api.ChatMessage[]) =>
  messages.reduce((n, m) => n + estimateTokens(m.content) + (m.images?.length ?? 0) * IMAGE_TOKENS + 4, 0);

/** Room for the reply (and tool definitions) that the prompt must leave free. */
function reserve(numCtx: number, numPredict: number, tools: number) {
  const reply = numPredict > 0 ? numPredict : 2048;
  return Math.min(Math.floor(numCtx / 3), reply) + tools * 250;
}

/** True when this prompt would leave too little room in the context window. */
export function overBudget(messages: api.ChatMessage[], numCtx: number, numPredict: number, tools = 0) {
  return messagesTokens(messages) > numCtx - reserve(numCtx, numPredict, tools);
}

const SUMMARY_PROMPT = `You write the memory of a conversation, so it can continue after its older messages are removed.
Summarize the conversation you're given, in the language the user writes in. Include: what the user wants and their preferences; facts, data, names, and numbers they gave; decisions and conclusions; what was produced (code, files, documents, widgets: names and what they do); and the task in progress or open questions. Keep exact details the user is likely to refer back to. Use short bullet points and no preamble. If there's a summary so far, write one merged summary: keep every fact from it (names, numbers, preferences) unless the new messages change it, and add what's new.`;

const transcript = (messages: api.ChatMessage[]) =>
  messages.map((m) => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Note'}: ${m.content}`).join('\n\n');

/** The longest summary to ask for: a quarter of the context, up to 1,500 tokens. */
const summaryLength = (numCtx: number) => Math.min(1500, Math.floor(numCtx / 4));

async function summarize(o: { model: string; numCtx: number; think?: boolean; signal?: AbortSignal }, previous: string, part: api.ChatMessage[]) {
  const input = `${previous ? `Summary so far:\n${previous}\n\n` : ''}Conversation to add:\n\n${transcript(part)}`;
  let text = '';
  for await (const chunk of api.chat(
    {
      model: o.model,
      messages: [{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: input }],
      // The summary has to fit in the context with its input, or Ollama drops the start (the summary so far).
      options: { num_ctx: o.numCtx, temperature: 0.2, num_predict: summaryLength(o.numCtx) },
      ...(o.think !== undefined ? { think: false } : {}),
    },
    o.signal,
  )) {
    text += chunk.message?.content ?? '';
  }
  text = text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '').trim();
  if (!text) throw new Error("The model didn't write a summary");
  return text;
}

/**
 * Summarizes the chat up to the most recent messages, which stay whole (about a third of the context, and
 * at least the last two). Long stretches are summarized in parts, each folded into the summary so far.
 * Returns null when there's nothing old enough to summarize.
 */
export async function compactChat(
  conv: Pick<Conversation, 'messages' | 'summary'>,
  o: { model: string; numCtx: number; think?: boolean; signal?: AbortSignal; history?: UiMessage[] },
): Promise<ChatSummary | null> {
  const history = (o.history ?? conv.messages).filter((m) => !m.error || m.content);
  const start = summaryEnd(history, conv.summary);
  let split = history.length - 2;
  let kept = messagesTokens(history.slice(split).map((m) => toApi(m, false)));
  while (split > start) {
    const t = messagesTokens([toApi(history[split - 1], true)]);
    if (kept + t > o.numCtx / 3) break;
    kept += t;
    split--;
  }
  // Don't end the summary on a question the model hasn't answered yet.
  while (split > start && history[split - 1].role === 'user') split--;
  if (split <= start) return null;

  const old = history.slice(start, split).map((m) => toApi(m, true));
  let text = start && conv.summary ? conv.summary.text : '';
  // Each request holds the summary so far and a stretch of chat, and leaves room for the new summary.
  const chunkBudget = o.numCtx - summaryLength(o.numCtx) - 400;
  for (let i = 0; i < old.length; ) {
    const part: api.ChatMessage[] = [];
    let size = estimateTokens(text);
    while (i < old.length && (part.length === 0 || size + messagesTokens([old[i]]) < chunkBudget)) {
      const m = old[i++];
      // A single huge message is cut to fit.
      const room = Math.floor(chunkBudget * 3.2);
      part.push(m.content.length > room ? { ...m, content: `${m.content.slice(0, room)}\n[…cut]` } : m);
      size += messagesTokens([part[part.length - 1]]);
    }
    text = await summarize(o, text, part);
  }
  return { text, upTo: history[split - 1].id, count: split, at: Date.now() };
}
