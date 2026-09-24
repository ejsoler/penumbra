import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import * as api from '../api';
import { DEFAULT_PARAMS, uid, usePersistent, type Conversation, type GenParams, type OllamaState, type UiMessage } from '../store';
import { ModelPicker } from '../components/ModelPicker';
import { Logo } from '../components/Logo';
import { shortcut } from '../platform';
import { Markdown, splitThinking } from '../components/Markdown';
import { copyText, downloadFile, useContextMenu } from '../components/ContextMenu';
import {
  ArrowUp, Brain, Check, ChevronRight, Copy, Download, Eraser, GitBranch, PanelRight, PanelRightClose, Paperclip, Pencil,
  Plus, RefreshCw, Square, Trash2, X,
} from '../components/icons';

const newConversation = (model = ''): Conversation => ({
  id: uid(),
  title: 'New Chat',
  model,
  systemPrompt: '',
  messages: [],
  updatedAt: Date.now(),
});

const roleName = (m: UiMessage) => (m.role === 'user' ? 'You' : m.model ?? 'Assistant');

function toMarkdown(c: Conversation): string {
  const parts = [`# ${c.title}`, `_Model: ${c.model || 'none'}_`];
  if (c.systemPrompt.trim()) parts.push(`> **System:** ${c.systemPrompt.trim().replace(/\n/g, '\n> ')}`);
  for (const m of c.messages) parts.push(`### ${roleName(m)}\n\n${m.content}`);
  return parts.join('\n\n') + '\n';
}

const fileSlug = (s: string) => s.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'chat';

export function ChatView({ ollama, pendingModel, onPendingHandled }: {
  ollama: OllamaState;
  pendingModel: string | null;
  onPendingHandled: () => void;
}) {
  const [conversations, setConversations] = usePersistent<Conversation[]>('ollama-gui.conversations', [newConversation()]);
  const [currentId, setCurrentId] = usePersistent<string>('ollama-gui.current', conversations[0]?.id ?? '');
  const [storedParams, setParams] = usePersistent<GenParams>('ollama-gui.params', DEFAULT_PARAMS);
  const [showSettings, setShowSettings] = usePersistent('ollama-gui.showSettings', true);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const menu = useContextMenu();
  const params = { ...DEFAULT_PARAMS, ...storedParams };

  const current = conversations.find((c) => c.id === currentId) ?? conversations[0];
  const caps = ollama.capabilities[current?.model] ?? [];

  const sorted = useMemo(() => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt), [conversations]);

  const updateConv = (id: string, fn: (c: Conversation) => Conversation) =>
    setConversations((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));

  const patchMessage = (convId: string, msgId: string, fn: (m: UiMessage) => UiMessage) =>
    updateConv(convId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)) }));

  const createChat = () => {
    const c = newConversation(current?.model);
    setConversations((cs) => [c, ...cs]);
    setCurrentId(c.id);
  };

  // Another page asked to start a chat with a specific model.
  // The ref guards against StrictMode running this effect twice for one request.
  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingModel) {
      handledRef.current = null;
      return;
    }
    if (handledRef.current === pendingModel) return;
    handledRef.current = pendingModel;
    const c = newConversation(pendingModel);
    setConversations((cs) => [c, ...cs]);
    setCurrentId(c.id);
    onPendingHandled();
  }, [pendingModel]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Copies a chat, optionally only up to (and including) one message — i.e. a branch. */
  const duplicateChat = (source: Conversation, uptoMsgId?: string) => {
    const end = uptoMsgId ? source.messages.findIndex((m) => m.id === uptoMsgId) + 1 : source.messages.length;
    const c: Conversation = {
      ...source,
      id: uid(),
      title: `${source.title} (${uptoMsgId ? 'branch' : 'copy'})`,
      messages: source.messages.slice(0, end).map((m) => ({ ...m, id: uid() })),
      updatedAt: Date.now(),
    };
    setConversations((cs) => [c, ...cs]);
    setCurrentId(c.id);
  };

  const chatMenu = (e: MouseEvent, c: Conversation) =>
    menu(e, [
      { label: 'Rename', icon: Pencil, onClick: () => setRenamingId(c.id) },
      { label: 'Duplicate', icon: Copy, onClick: () => duplicateChat(c) },
      'separator',
      { label: 'Copy as Markdown', icon: Copy, onClick: () => copyText(toMarkdown(c)), disabled: !c.messages.length },
      { label: 'Export as Markdown…', icon: Download, onClick: () => downloadFile(`${fileSlug(c.title)}.md`, toMarkdown(c)), disabled: !c.messages.length },
      'separator',
      { label: 'Clear messages', icon: Eraser, onClick: () => updateConv(c.id, (x) => ({ ...x, messages: [] })), disabled: !c.messages.length || streamingId === c.id },
      { label: 'Delete chat', icon: Trash2, danger: true, onClick: () => deleteChat(c.id) },
    ]);

  const deleteChat = (id: string) => {
    if (streamingId === id) abortRef.current?.abort();
    setConversations((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      const next = rest.length ? rest : [newConversation(current?.model)];
      if (id === currentId) setCurrentId(next[0].id);
      return next;
    });
  };

  const generate = async (conv: Conversation, history: UiMessage[]) => {
    const assistant: UiMessage = { id: uid(), role: 'assistant', content: '', model: conv.model };
    updateConv(conv.id, (c) => ({ ...c, messages: [...history, assistant], updatedAt: Date.now() }));

    const ac = new AbortController();
    abortRef.current = ac;
    setStreamingId(conv.id);

    const messages: api.ChatMessage[] = [
      ...(conv.systemPrompt.trim() ? [{ role: 'system' as const, content: conv.systemPrompt }] : []),
      ...history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images } : {}) })),
    ];
    const options: Record<string, number> = {
      temperature: params.temperature,
      top_p: params.top_p,
      top_k: params.top_k,
      min_p: params.min_p,
      repeat_penalty: params.repeat_penalty,
      num_ctx: params.num_ctx,
      num_predict: params.num_predict,
    };
    if (params.seed >= 0) options.seed = params.seed;

    const start = performance.now();
    let ttft = 0;
    try {
      const stream = api.chat(
        {
          model: conv.model,
          messages,
          options,
          keep_alive: params.keep_alive,
          ...(caps.includes('thinking') ? { think: params.think } : {}),
        },
        ac.signal,
      );
      for await (const chunk of stream) {
        const piece = chunk.message?.content ?? '';
        const thought = chunk.message?.thinking ?? '';
        if ((piece || thought) && !ttft) ttft = (performance.now() - start) / 1000;
        if (piece || thought) {
          patchMessage(conv.id, assistant.id, (m) => ({ ...m, content: m.content + piece, thinking: (m.thinking ?? '') + thought }));
        }
        if (chunk.done) {
          const tokens = chunk.eval_count ?? 0;
          const evalSec = (chunk.eval_duration ?? 0) / 1e9;
          patchMessage(conv.id, assistant.id, (m) => ({
            ...m,
            stats: {
              tokens,
              tps: evalSec ? tokens / evalSec : 0,
              ttft,
              promptTokens: chunk.prompt_eval_count ?? 0,
              seconds: (performance.now() - start) / 1000,
            },
          }));
        }
      }
    } catch (e) {
      if (ac.signal.aborted) patchMessage(conv.id, assistant.id, (m) => ({ ...m, stopped: true }));
      else patchMessage(conv.id, assistant.id, (m) => ({ ...m, error: (e as Error).message }));
    } finally {
      setStreamingId(null);
      abortRef.current = null;
      ollama.refresh();
    }
  };

  const send = (text: string, images: string[]) => {
    if (!current || !current.model || streamingId) return;
    const user: UiMessage = { id: uid(), role: 'user', content: text, ...(images.length ? { images } : {}) };
    const title = current.messages.length === 0 ? text.slice(0, 48) || 'Image' : current.title;
    const conv = { ...current, title };
    updateConv(current.id, (c) => ({ ...c, title }));
    generate(conv, [...current.messages, user]);
  };

  const regenerate = (msgId: string) => {
    if (!current || streamingId) return;
    const idx = current.messages.findIndex((m) => m.id === msgId);
    generate(current, current.messages.slice(0, idx));
  };

  const editAndResend = (msgId: string, text: string) => {
    if (!current || streamingId) return;
    const idx = current.messages.findIndex((m) => m.id === msgId);
    const edited = { ...current.messages[idx], content: text };
    generate(current, [...current.messages.slice(0, idx), edited]);
  };

  const deleteMessage = (msgId: string) =>
    current && updateConv(current.id, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== msgId) }));

  if (!current) return null;
  const isStreaming = streamingId === current.id;

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="sidebar-title">Chats</span>
          <button className="icon-btn" onClick={createChat} title={`New chat (${shortcut('N')})`}>
            <Plus size={16} />
          </button>
        </div>
        <div className="conv-list">
          {sorted.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${c.id === current.id ? 'active' : ''}`}
              onClick={() => setCurrentId(c.id)}
              onDoubleClick={() => setRenamingId(c.id)}
              onContextMenu={(e) => chatMenu(e, c)}
            >
              <div className="conv-text">
                {renamingId === c.id ? (
                  <input
                    className="conv-rename"
                    autoFocus
                    defaultValue={c.title}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const title = e.target.value.trim();
                      if (title) updateConv(c.id, (x) => ({ ...x, title }));
                      setRenamingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <span className="conv-title">{c.title}</span>
                )}
                <span className="conv-sub">{c.model || 'No model'}</span>
              </div>
              {streamingId === c.id && <span className="dot on pulse" />}
              <button
                className="icon-btn sm conv-del"
                title="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteChat(c.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="chat">
        <header className="topbar">
          <ModelPicker
            ollama={ollama}
            value={current.model}
            keepAlive={params.keep_alive}
            numCtx={params.num_ctx}
            onChange={(model) => updateConv(current.id, (c) => ({ ...c, model }))}
          />
          <button className="icon-btn topbar-right" onClick={() => setShowSettings(!showSettings)} title="Toggle settings panel">
            {showSettings ? <PanelRightClose size={17} /> : <PanelRight size={17} />}
          </button>
        </header>

        <Messages
          messages={current.messages}
          streaming={isStreaming}
          hasModel={!!current.model}
          onRegenerate={regenerate}
          onDelete={deleteMessage}
          onEdit={editAndResend}
          onBranch={(id) => duplicateChat(current, id)}
        />

        <Composer
          disabled={!current.model}
          streaming={isStreaming}
          vision={caps.includes('vision')}
          onSend={send}
          onStop={() => abortRef.current?.abort()}
          onNewChat={createChat}
        />
      </main>

      {showSettings && (
        <SettingsPanel
          params={params}
          setParams={(p) => setParams({ ...params, ...p })}
          systemPrompt={current.systemPrompt}
          setSystemPrompt={(systemPrompt) => updateConv(current.id, (c) => ({ ...c, systemPrompt }))}
          thinkingSupported={caps.includes('thinking')}
          contextTokens={(() => {
            const s = [...current.messages].reverse().find((m) => m.stats)?.stats;
            return s ? s.promptTokens + s.tokens : 0;
          })()}
        />
      )}
    </>
  );
}

function Messages(props: {
  messages: UiMessage[];
  streaming: boolean;
  hasModel: boolean;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onBranch: (id: string) => void;
}) {
  const { messages, streaming } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!messages.length) {
    return (
      <div className="messages empty">
        <div className="empty-state">
          <div className="logo-big"><Logo size={56} /></div>
          <h2>{props.hasModel ? 'Start a conversation' : 'Load a model to begin'}</h2>
          <p className="muted">
            {props.hasModel ? 'Type a message below. Shift+Enter for a new line.' : `Pick a model from the selector above, or press ${shortcut('L')}.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="messages"
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="messages-inner">
        {messages.map((m, i) => (
          <MessageView
            key={m.id}
            msg={m}
            live={streaming && i === messages.length - 1}
            busy={streaming}
            onRegenerate={() => props.onRegenerate(m.id)}
            onDelete={() => props.onDelete(m.id)}
            onEdit={(t) => props.onEdit(m.id, t)}
            onBranch={() => props.onBranch(m.id)}
          />
        ))}
      </div>
    </div>
  );
}

function MessageView({ msg, live, busy, onRegenerate, onDelete, onEdit, onBranch }: {
  msg: UiMessage;
  live: boolean;
  busy: boolean;
  onRegenerate: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
  onBranch: () => void;
}) {
  const menu = useContextMenu();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const inline = splitThinking(msg.content);
  const thinking = (msg.thinking || inline.thinking).trim();
  const answer = msg.thinking ? msg.content : inline.answer;
  const stillThinking = live && !answer;

  const copy = () => {
    navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startEdit = () => {
    setDraft(msg.content);
    setEditing(true);
  };

  const onContextMenu = (e: MouseEvent) => {
    const selection = window.getSelection()?.toString() ?? '';
    menu(e, [
      selection && { label: 'Copy selection', icon: Copy, hint: shortcut('C'), onClick: () => copyText(selection) },
      { label: msg.role === 'assistant' ? 'Copy response' : 'Copy message', icon: Copy, onClick: copy, disabled: !answer },
      thinking && { label: 'Copy thought process', icon: Brain, onClick: () => copyText(thinking) },
      'separator',
      msg.role === 'user' && { label: 'Edit & resend', icon: Pencil, onClick: startEdit, disabled: busy },
      msg.role === 'assistant' && { label: 'Regenerate', icon: RefreshCw, onClick: onRegenerate, disabled: busy },
      { label: 'Branch chat from here', icon: GitBranch, onClick: onBranch, disabled: live },
      'separator',
      { label: 'Delete message', icon: Trash2, danger: true, onClick: onDelete, disabled: busy },
    ]);
  };

  return (
    <div className={`msg ${msg.role}`} onContextMenu={onContextMenu}>
      <div className="msg-role">{msg.role === 'user' ? 'You' : msg.model ?? 'Assistant'}</div>
      {msg.images?.length ? (
        <div className="msg-images">
          {msg.images.map((b64, i) => (
            <img key={i} src={`data:image/*;base64,${b64}`} alt="" />
          ))}
        </div>
      ) : null}
      {thinking && <Thinking text={thinking} active={stillThinking} />}
      {editing ? (
        <div className="msg-edit">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(12, draft.split('\n').length + 1)} autoFocus />
          <div className="row gap">
            <button className="btn primary sm" onClick={() => { setEditing(false); onEdit(draft); }}>Save & resend</button>
            <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : msg.role === 'user' ? (
        <div className="msg-body user-text">{msg.content}</div>
      ) : (
        <div className="msg-body">
          {answer ? <Markdown text={answer} /> : live && !thinking ? <span className="typing"><i /><i /><i /></span> : null}
          {live && answer && <span className="cursor" />}
        </div>
      )}
      {msg.error && <div className="msg-error">⚠ {msg.error}</div>}
      {!live && !editing && (
        <div className="msg-footer">
          {msg.stats && (
            <span className="stats mono">
              {msg.stats.tps.toFixed(1)} tok/s · {msg.stats.tokens} tokens · {msg.stats.ttft.toFixed(2)}s to first token
              {msg.stopped ? ' · stopped' : ''}
            </span>
          )}
          {msg.stopped && !msg.stats && <span className="stats">Stopped</span>}
          <span className="msg-actions">
            <button className="icon-btn sm" onClick={copy} title="Copy">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
            {msg.role === 'user' && !busy && (
              <button className="icon-btn sm" onClick={startEdit} title="Edit & resend"><Pencil size={13} /></button>
            )}
            {msg.role === 'assistant' && !busy && (
              <button className="icon-btn sm" onClick={onRegenerate} title="Regenerate"><RefreshCw size={13} /></button>
            )}
            {!busy && <button className="icon-btn sm" onClick={onDelete} title="Delete message"><Trash2 size={13} /></button>}
          </span>
        </div>
      )}
    </div>
  );
}

function Thinking({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`thinking ${open || active ? 'open' : ''}`}>
      <button className="thinking-head" onClick={() => setOpen(!open)}>
        <Brain size={13} />
        <span>{active ? 'Thinking…' : 'Thought process'}</span>
        <ChevronRight size={13} className="chev" />
      </button>
      {(open || active) && <div className="thinking-body">{text}</div>}
    </div>
  );
}

function Composer({ disabled, streaming, vision, onSend, onStop, onNewChat }: {
  disabled: boolean;
  streaming: boolean;
  vision: boolean;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
  onNewChat: () => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onNewChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNewChat]);

  const addFiles = async (files: FileList | File[]) => {
    const encoded = await Promise.all(
      [...files].filter((f) => f.type.startsWith('image/')).map(
        (f) =>
          new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1]);
            r.readAsDataURL(f);
          }),
      ),
    );
    setImages((im) => [...im, ...encoded]);
  };

  const submit = () => {
    if (disabled || streaming || (!text.trim() && !images.length)) return;
    onSend(text.trim(), images);
    setText('');
    setImages([]);
  };

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${disabled ? 'disabled' : ''}`}
        onDragOver={(e) => vision && e.preventDefault()}
        onDrop={(e) => {
          if (!vision) return;
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        {images.length > 0 && (
          <div className="composer-images">
            {images.map((b64, i) => (
              <div key={i} className="thumb">
                <img src={`data:image/*;base64,${b64}`} alt="" />
                <button onClick={() => setImages(images.filter((_, j) => j !== i))}><X size={11} /></button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? 'Select a model first…' : 'Send a message…'}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => vision && e.clipboardData.files.length && addFiles(e.clipboardData.files)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-bar">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <button
            className="icon-btn"
            disabled={!vision}
            title={vision ? 'Attach images' : 'This model does not support images'}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={16} />
          </button>
          <span className="flex" />
          {streaming ? (
            <button className="send-btn stop" onClick={onStop} title="Stop generating"><Square size={14} fill="currentColor" /></button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={disabled || (!text.trim() && !images.length)} title="Send (Enter)">
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ params, setParams, systemPrompt, setSystemPrompt, thinkingSupported, contextTokens }: {
  params: GenParams;
  setParams: (p: Partial<GenParams>) => void;
  systemPrompt: string;
  setSystemPrompt: (s: string) => void;
  thinkingSupported: boolean;
  contextTokens: number;
}) {
  const ctxUsed = Math.min(100, (contextTokens / params.num_ctx) * 100);
  return (
    <aside className="settings">
      <div className="settings-scroll">
        <section>
          <h4>System Prompt</h4>
          <textarea
            className="sys-prompt"
            placeholder="You are a helpful assistant…"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
          />
        </section>

        <section>
          <h4>Context</h4>
          <div className="ctx-meter">
            <div className="ctx-bar"><div style={{ width: `${ctxUsed}%` }} /></div>
            <span className="muted mono">{contextTokens.toLocaleString()} / {params.num_ctx.toLocaleString()} tokens</span>
          </div>
        </section>

        <section>
          <h4>Sampling</h4>
          <Slider label="Temperature" value={params.temperature} min={0} max={2} step={0.05} onChange={(temperature) => setParams({ temperature })} />
          <Slider label="Top K" value={params.top_k} min={1} max={200} step={1} onChange={(top_k) => setParams({ top_k })} />
          <Slider label="Top P" value={params.top_p} min={0} max={1} step={0.01} onChange={(top_p) => setParams({ top_p })} />
          <Slider label="Min P" value={params.min_p} min={0} max={1} step={0.01} onChange={(min_p) => setParams({ min_p })} />
          <Slider label="Repeat Penalty" value={params.repeat_penalty} min={0.5} max={2} step={0.01} onChange={(repeat_penalty) => setParams({ repeat_penalty })} />
        </section>

        <section>
          <h4>Generation</h4>
          <NumberField label="Context Length" value={params.num_ctx} min={256} step={1024} onChange={(num_ctx) => setParams({ num_ctx })} />
          <NumberField label="Max Tokens" hint="-1 = unlimited" value={params.num_predict} min={-1} step={128} onChange={(num_predict) => setParams({ num_predict })} />
          <NumberField label="Seed" hint="-1 = random" value={params.seed} min={-1} step={1} onChange={(seed) => setParams({ seed })} />
          <label className="field">
            <span>Keep Alive</span>
            <select value={params.keep_alive} onChange={(e) => setParams({ keep_alive: e.target.value })}>
              {['5m', '30m', '1h', '4h', '-1'].map((v) => (
                <option key={v} value={v}>{v === '-1' ? 'Forever' : v}</option>
              ))}
            </select>
          </label>
          <label className={`field toggle ${thinkingSupported ? '' : 'dim'}`} title={thinkingSupported ? '' : 'Current model does not support reasoning'}>
            <span>Reasoning / Thinking</span>
            <input type="checkbox" checked={params.think} disabled={!thinkingSupported} onChange={(e) => setParams({ think: e.target.checked })} />
          </label>
        </section>

        <button className="btn sm ghost" onClick={() => setParams(DEFAULT_PARAMS)}>Reset to defaults</button>
      </div>
    </aside>
  );
}

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <input
          className="num"
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))}
        />
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function NumberField({ label, hint, value, min, step, onChange }: {
  label: string; hint?: string; value: number; min: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}{hint && <small className="muted"> {hint}</small>}</span>
      <input className="num wide" type="number" value={value} min={min} step={step} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
    </label>
  );
}
