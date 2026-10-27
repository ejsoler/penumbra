// App-wide chat state: the conversations, which one is generating, and a pending tool approval.
// It lives outside any view so a reply or an orchestrator run keeps going when you switch tabs, and
// so the Orchestrator page can show and drive runs that belong to chats.
import { useSyncExternalStore } from 'react';
import type { Approval, ApprovalRequest } from './agents/tools';
import type { Conversation } from './store';

type Listener = () => void;

/** A tiny observable value with a React hook. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (next: T | ((prev: T) => T)) => {
      value = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      listeners.forEach((l) => l());
    },
    use: () =>
      useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => value,
      ),
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// ---- conversations (persisted, debounced so streaming doesn't thrash storage) -------------------

const KEY = 'ollama-gui.conversations';

function loadConversations(fallback: () => Conversation): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return list.length ? list : [fallback()];
  } catch {
    return [fallback()];
  }
}

let conversations: ReturnType<typeof store<Conversation[]>> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

function saveNow() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  try {
    localStorage.setItem(KEY, JSON.stringify(conversations!.get()));
  } catch (e) {
    console.warn('Could not save chats', e);
  }
}

function conversationsStore(fallback: () => Conversation) {
  if (!conversations) {
    conversations = store(loadConversations(fallback));
    conversations.subscribe(() => {
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 400);
    });
    // Don't lose the last half second of a reply when the app closes. Only unsaved changes are
    // written, so this never overwrites what another window (or a newer save) put there.
    addEventListener('beforeunload', saveNow);
  }
  return conversations;
}

/** [conversations, setConversations], shared by every view. `fallback` makes the first chat when there are none. */
export function useConversations(fallback: () => Conversation) {
  const s = conversationsStore(fallback);
  return [s.use(), s.set] as const;
}

export const getConversations = () => conversations?.get() ?? [];

// ---- run state ------------------------------------------------------------------------------------

/** The conversation currently generating (one at a time). */
export const streaming = store<string | null>(null);

/** A tool waiting for the user's OK. Shown in the chat and on the Orchestrator page. */
export const approval = store<{ req: ApprovalRequest; resolve: (a: Approval) => void; convId: string } | null>(null);

/** Actions the chat view offers to other views (it stays mounted, so these keep working). */
export interface ChatController {
  /** Starts an orchestrator run in a new chat and returns that chat's id. */
  startOrchestration: (goal: string, model: string, folder?: string) => string | null;
  runPlan: (msgId: string) => void;
  cancelPlan: (convId: string, msgId: string) => void;
  changePlan: (convId: string, msgId: string, plan: import('./agents/orchestrator').Plan) => void;
  stop: () => void;
  openChat: (convId: string) => void;
}

export const chatController: { current: ChatController | null } = { current: null };
