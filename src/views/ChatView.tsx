import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import * as api from '../api';
import { DEFAULT_PARAMS, isInteractive, uid, usePersistent, type Conversation, type GenParams, type OllamaState, type UiMessage } from '../store';
import { INTERACTIVE_MIN_CTX } from '../widgets/prompt';
import { createAgent, getAgent, useAgents, type Agent } from '../agents/agents';
import {
  normalizePlan, ORCHESTRATOR_ID, parsePlanText, planningPrompt, PROPOSE_PLAN, synthesisMessages, taskMessage,
  type ModelInfo, type Orchestration, type PlanTask,
} from '../agents/orchestrator';
import { PlanActionsContext, PlanCard, type PlanActions } from '../components/PlanCard';
import { runAgent, type Step } from '../agents/engine';
import { DEFAULT_CHAT_TOOLS, replySetup } from '../agents/setup';
import { enabledSkills, useSkills } from '../agents/skills';
import { TOOL_GROUPS, type ToolGroup } from '../agents/builtins';
import type { Approval, ApprovalRequest } from '../agents/tools';
import { host } from '../host';
import { approval as approvalStore, chatController, getConversations, streaming, useConversations, type RunOptions } from '../session';
import { APPROVED_SITES, removeAlwaysAllowed, setNetMode, useNetSettings } from '../widgets/network';
import { ModelPicker } from '../components/ModelPicker';
import { Logo } from '../components/Logo';
import { shortcut } from '../platform';
import { Markdown, splitThinking } from '../components/Markdown';
import { Steps } from '../components/Steps';
import { WidgetActionsContext, type WidgetActions } from '../components/Widget';
import { copyText, downloadFile, useContextMenu } from '../components/ContextMenu';
import {
  ArrowUp, Bot, Brain, Check, ChevronDown, FileText, FolderOpen, ShieldAlert, Workflow, ChevronRight, Copy, Download, Eraser, GitBranch, Globe, PanelRight, PanelRightClose, Paperclip, Pencil,
  Plus, RefreshCw, Sparkles, Square, Trash2, TriangleAlert, X,
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

export function ChatView({ ollama, pendingModel, pendingAgent, onPendingHandled, onManageAgents }: {
  ollama: OllamaState;
  pendingModel: string | null;
  pendingAgent: string | null;
  onPendingHandled: () => void;
  onManageAgents: () => void;
}) {
  const agents = useAgents();
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const getAgentByName = (name: string) => agentsRef.current.find((a) => a.name.toLowerCase() === name.toLowerCase());
  useSkills(); // re-render when skills change, since they affect the tools a reply gets
  const [conversations, setConversations] = useConversations(newConversation);
  const [currentId, setCurrentId] = usePersistent<string>('ollama-gui.current', conversations[0]?.id ?? '');
  const [storedParams, setParams] = usePersistent<GenParams>('ollama-gui.params', DEFAULT_PARAMS);
  const [showSettings, setShowSettings] = usePersistent('ollama-gui.showSettings', true);
  const streamingId = streaming.use();
  const setStreamingId = streaming.set;
  const abortRef = useRef<AbortController | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [noticeSeen, setNoticeSeen] = usePersistent('ollama-gui.interactiveNoticeSeen', false);
  const [pendingSend, setPendingSend] = useState<{ text: string; images: string[]; files: Attachment[] } | null>(null);
  // A tool waiting for the user's OK (a command, a site). Shared, so the Orchestrator page shows it too.
  const pendingApproval = approvalStore.use();
  // Text a widget asked to put in the message box; `n` makes repeats of the same text count.
  const [composerFill, setComposerFill] = useState<{ text: string; n: number } | null>(null);
  const menu = useContextMenu();
  const params = { ...DEFAULT_PARAMS, ...storedParams };

  const current = conversations.find((c) => c.id === currentId) ?? conversations[0];
  const agent = agents.find((a) => a.id === current?.agentId);
  // With an agent, the agent's model answers.
  const activeModel = agent?.model || current?.model || '';
  const caps = ollama.capabilities[activeModel] ?? [];
  const interactive = isInteractive(current);
  // Widgets are long; make sure the model has room for them.
  // Widgets and tool results are long; make sure the model has room for them (generate() does the same).
  const usesTools = caps.includes('tools') && (agent ? agent.tools : current?.tools ?? DEFAULT_CHAT_TOOLS).some((t) => t !== 'skills' || enabledSkills().length > 0);
  const numCtx = interactive || usesTools ? Math.max(params.num_ctx, INTERACTIVE_MIN_CTX) : params.num_ctx;

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
    const key = pendingModel ?? (pendingAgent && `agent:${pendingAgent}`);
    if (!key) {
      handledRef.current = null;
      return;
    }
    if (handledRef.current === key) return;
    handledRef.current = key;
    const pendingAgentObj = pendingAgent ? getAgent(pendingAgent) : undefined;
    const c = { ...newConversation(pendingModel ?? pendingAgentObj?.model ?? current?.model), ...(pendingAgent ? { agentId: pendingAgent, title: `Chat with ${pendingAgentObj?.name ?? 'agent'}` } : {}) };
    setConversations((cs) => [c, ...cs]);
    setCurrentId(c.id);
    onPendingHandled();
  }, [pendingModel, pendingAgent]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** Asks the user through the approval bar; a stopped run counts as "no". */
  const approver = (ac: AbortController, convId: string, preApproved: string[] = []) => {
    // Tools the user said yes to for the rest of this run ("Allow all sites for this run").
    const allowedForRun = new Set<string>();
    return (req: ApprovalRequest) =>
    new Promise<Approval>((resolve) => {
      if (ac.signal.aborted) return resolve(false);
      // A scheduled task's own settings ("without asking"); anything else still asks.
      if (preApproved.includes(req.tool)) return resolve(true);
      if (req.forRun && allowedForRun.has(req.tool)) return resolve(true);
      const done = (a: Approval) => {
        ac.signal.removeEventListener('abort', cancel);
        approvalStore.set(null);
        if (a === 'run') allowedForRun.add(req.tool);
        resolve(a);
      };
      const cancel = () => done(false);
      ac.signal.addEventListener('abort', cancel, { once: true });
      approvalStore.set({ req, resolve: done, convId });
    });
  };

  const genOptions = (temperature: number | undefined, bigContext: boolean) => {
    const options: Record<string, number> = {
      temperature: temperature ?? params.temperature,
      top_p: params.top_p,
      top_k: params.top_k,
      min_p: params.min_p,
      repeat_penalty: params.repeat_penalty,
      num_ctx: bigContext ? Math.max(params.num_ctx, INTERACTIVE_MIN_CTX) : params.num_ctx,
      num_predict: params.num_predict,
    };
    if (params.seed >= 0) options.seed = params.seed;
    return options;
  };

  const modelInfos = (): ModelInfo[] =>
    ollama.models.map((m) => ({
      name: m.name,
      size: m.details.parameter_size,
      capabilities: ollama.capabilities[m.name] ?? [],
      loaded: ollama.running.some((r) => r.name === m.name),
      remote: !!m.remote_host,
    }));

  // ---- orchestrator ----------------------------------------------------------------------------
  const convRef = useRef(conversations);
  convRef.current = conversations;
  const patchOrch = (convId: string, msgId: string, fn: (o: Orchestration) => Orchestration) =>
    patchMessage(convId, msgId, (m) => (m.orchestration ? { ...m, orchestration: fn(m.orchestration) } : m));
  const patchTask = (convId: string, msgId: string, taskId: string, fn: (t: PlanTask) => PlanTask) =>
    patchOrch(convId, msgId, (o) => (o.plan ? { ...o, plan: { ...o.plan, tasks: o.plan.tasks.map((t) => (t.id === taskId ? fn(t) : t)) } } : o));

  /** Step 1: the orchestrator's model proposes a plan, which waits for the user's review. */
  const planOrchestration = async (conv: Conversation, history: UiMessage[], run: RunOptions = {}) => {
    const model = conv.model;
    const goal = withFiles(history[history.length - 1]);
    const assistant: UiMessage = { id: uid(), role: 'assistant', content: '', model, agentId: ORCHESTRATOR_ID, orchestration: { goal, phase: 'planning' } };
    updateConv(conv.id, (c) => ({ ...c, messages: [...history, assistant], updatedAt: Date.now() }));
    const ac = new AbortController();
    abortRef.current = ac;
    setStreamingId(conv.id);
    const models = modelInfos();
    const caps = ollama.capabilities[model] ?? [];
    const toolsOk = caps.includes('tools');
    const system = planningPrompt({ agents: agentsRef.current, models, folder: conv.folder, toolsSupported: toolsOk });
    const messages: api.ChatMessage[] = [
      { role: 'system', content: system },
      ...(run.fresh ? history.slice(-1) : history).filter((m) => !m.error).map((m) => ({ role: m.role, content: withFiles(m) })),
    ];
    try {
      let raw: Record<string, unknown> | null = null;
      let said = '';
      for (let attempt = 0; attempt < 2 && !raw; attempt++) {
        let text = '';
        for await (const chunk of api.chat(
          { model, messages, options: genOptions(0.3, true), keep_alive: params.keep_alive, ...(toolsOk ? { tools: [PROPOSE_PLAN] } : {}), ...(caps.includes('thinking') ? { think: params.think } : {}) },
          ac.signal,
        )) {
          text += chunk.message?.content ?? '';
          const call = chunk.message?.tool_calls?.find((c) => c.function.name === 'propose_plan');
          if (call) raw = call.function.arguments as Record<string, unknown>;
        }
        raw ??= parsePlanText(text);
        said = text;
        if (!raw) messages.push({ role: 'assistant', content: text }, { role: 'user', content: toolsOk ? 'Call the propose_plan tool now with your plan.' : 'Reply with only the JSON plan.' });
      }
      const plan = raw ? normalizePlan(raw, { agents: agentsRef.current, models, fallbackModel: model }) : null;
      if (!plan || !plan.tasks.length) {
        patchOrch(conv.id, assistant.id, (o) => ({ ...o, phase: 'error', error: "The model didn't produce a usable plan. Try again, rephrase the request, or pick a larger model for the orchestrator.", plannerNote: said }));
      } else {
        patchOrch(conv.id, assistant.id, (o) => ({ ...o, phase: 'review', plan }));
      }
    } catch (e) {
      if (ac.signal.aborted) patchOrch(conv.id, assistant.id, (o) => ({ ...o, phase: 'cancelled' }));
      else patchOrch(conv.id, assistant.id, (o) => ({ ...o, phase: 'error', error: (e as Error).message }));
    } finally {
      setStreamingId(null);
      abortRef.current = null;
      ollama.refresh();
    }
  };

  /** Step 2: create the new agents, run every task on its agent in order, then write the answer. */
  const runPlan = async (msgId: string, run: RunOptions = {}) => {
    // Read the store directly: a scheduled task calls this right after planning, before a re-render.
    const conv = getConversations().find((c) => c.messages.some((m) => m.id === msgId));
    const msg = conv?.messages.find((m) => m.id === msgId);
    const orch = msg?.orchestration;
    if (!conv || !orch?.plan || streaming.get()) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setStreamingId(conv.id);
    // New agents become real agents, so they can be reused and edited later.
    for (const draft of orch.plan.newAgents) {
      if (!agentsRef.current.some((a) => a.name.toLowerCase() === draft.name.toLowerCase())) {
        createAgent({ ...draft, skills: [], createdBy: 'orchestrator' });
      }
    }
    const approve = approver(ac, conv.id, run.preApproved); // one for the whole plan, so "for this run" covers every task
    const tasks: PlanTask[] = orch.plan.tasks.map((t) => ({ ...t, status: 'pending', output: '', steps: [], error: undefined, stats: undefined }));
    patchOrch(conv.id, msgId, (o) => ({ ...o, phase: 'running', plan: { ...o.plan!, tasks } }));
    try {
      for (const task of tasks) {
        if (ac.signal.aborted) break;
        const failedDep = task.dependsOn.find((d) => tasks.find((t) => t.id === d)?.status !== 'done');
        if (failedDep) {
          task.status = 'skipped';
          task.error = `Skipped because ${failedDep} didn't finish.`;
          patchTask(conv.id, msgId, task.id, (t) => ({ ...t, status: 'skipped', error: task.error }));
          continue;
        }
        const agent = getAgentByName(task.agent);
        const model = agent?.model || conv.model;
        task.model = model;
        task.status = 'running';
        patchTask(conv.id, msgId, task.id, (t) => ({ ...t, status: 'running', model }));
        const caps = ollama.capabilities[model] ?? [];
        const { system, tools } = replySetup({ agent, systemPrompt: '', interactive: false, toolsSupported: caps.includes('tools'), folder: conv.folder });
        try {
          const result = await runAgent({
            model,
            messages: [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user', content: taskMessage(orch.goal, task, tasks) }],
            tools,
            options: genOptions(agent?.temperature, tools.length > 0),
            keepAlive: params.keep_alive,
            ...(caps.includes('thinking') ? { think: params.think } : {}),
            signal: ac.signal,
            approve,
            onText: (piece) => {
              task.output = (task.output ?? '') + piece;
              patchTask(conv.id, msgId, task.id, (t) => ({ ...t, output: (t.output ?? '') + piece }));
            },
            onStep: (step) =>
              patchTask(conv.id, msgId, task.id, (t) => {
                const steps = t.steps ?? [];
                const i = steps.findIndex((x) => x.id === step.id);
                return { ...t, steps: i < 0 ? [...steps, step] : steps.map((x) => (x.id === step.id ? step : x)) };
              }),
          });
          task.status = 'done';
          task.output = result.content;
          patchTask(conv.id, msgId, task.id, (t) => ({ ...t, status: 'done', output: result.content, stats: result.stats }));
        } catch (e) {
          if (ac.signal.aborted) throw e;
          task.status = 'error';
          task.error = (e as Error).message;
          patchTask(conv.id, msgId, task.id, (t) => ({ ...t, status: 'error', error: task.error }));
        }
      }
      if (ac.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      // Step 3: the orchestrator writes the answer from the results, streaming into the message.
      patchOrch(conv.id, msgId, (o) => ({ ...o, phase: 'writing' }));
      const caps = ollama.capabilities[conv.model] ?? [];
      const { system } = replySetup({ systemPrompt: conv.systemPrompt, interactive: isInteractive(conv), toolsSupported: false });
      const final = await runAgent({
        model: conv.model,
        messages: synthesisMessages(orch.goal, { ...orch.plan, tasks }, system || 'You are a helpful assistant.'),
        options: genOptions(undefined, true),
        keepAlive: params.keep_alive,
        ...(caps.includes('thinking') ? { think: params.think } : {}),
        signal: ac.signal,
        onText: (piece) => patchMessage(conv.id, msgId, (m) => ({ ...m, content: m.content + piece })),
        onThinking: (piece) => patchMessage(conv.id, msgId, (m) => ({ ...m, thinking: (m.thinking ?? '') + piece })),
      });
      patchMessage(conv.id, msgId, (m) => ({ ...m, stats: final.stats, orchestration: m.orchestration && { ...m.orchestration, phase: 'done' } }));
    } catch (e) {
      const stopped = ac.signal.aborted;
      patchOrch(conv.id, msgId, (o) => ({
        ...o,
        phase: stopped ? 'cancelled' : 'error',
        error: stopped ? undefined : (e as Error).message,
        plan: o.plan && { ...o.plan, tasks: o.plan.tasks.map((t) => (t.status === 'running' ? { ...t, status: 'error', error: 'Stopped' } : t)) },
      }));
      if (stopped) patchMessage(conv.id, msgId, (m) => ({ ...m, stopped: true }));
    } finally {
      setStreamingId(null);
      abortRef.current = null;
      ollama.refresh();
    }
  };

  const planActions: PlanActions = {
    agents,
    models: modelInfos(),
    busy: !!streamingId,
    change: (msgId, plan) => current && patchOrch(current.id, msgId, (o) => ({ ...o, plan })),
    run: runPlan,
    cancel: (msgId) => current && patchOrch(current.id, msgId, (o) => ({ ...o, phase: 'cancelled' })),
  };

  /** `run.fresh` sends only the last message (a scheduled task's runs don't build on each other). */
  const generate = async (conv: Conversation, history: UiMessage[], run: RunOptions = {}) => {
    if (conv.agentId === ORCHESTRATOR_ID) return planOrchestration(conv, history, run);
    const agent = getAgent(conv.agentId);
    const model = agent?.model || conv.model;
    const assistant: UiMessage = { id: uid(), role: 'assistant', content: '', model, ...(agent ? { agentId: agent.id } : {}) };
    updateConv(conv.id, (c) => ({ ...c, messages: [...history, assistant], updatedAt: Date.now() }));

    const ac = new AbortController();
    abortRef.current = ac;
    setStreamingId(conv.id);

    const modelCaps = ollama.capabilities[model] ?? [];
    const { system, tools } = replySetup({
      agent,
      systemPrompt: conv.systemPrompt,
      interactive: isInteractive(conv),
      toolsSupported: modelCaps.includes('tools'),
      chatTools: conv.tools,
      folder: conv.folder,
    });
    const messages: api.ChatMessage[] = [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      ...(run.fresh ? history.slice(-1) : history).filter((m) => !m.error).map((m) => ({ role: m.role, content: withFiles(m), ...(m.images?.length ? { images: m.images } : {}) })),
    ];
    const options = genOptions(agent?.temperature, isInteractive(conv) || tools.length > 0);

    const patch = (fn: (m: UiMessage) => UiMessage) => patchMessage(conv.id, assistant.id, fn);
    try {
      const result = await runAgent({
        model,
        messages,
        tools,
        options,
        keepAlive: params.keep_alive,
        ...(modelCaps.includes('thinking') ? { think: params.think } : {}),
        signal: ac.signal,
        approve: approver(ac, conv.id, run.preApproved),
        onText: (piece) => patch((m) => ({ ...m, content: m.content + piece })),
        onThinking: (piece) => patch((m) => ({ ...m, thinking: (m.thinking ?? '') + piece })),
        onStep: (step) =>
          patch((m) => {
            const steps = m.steps ?? [];
            const i = steps.findIndex((x) => x.id === step.id);
            return { ...m, steps: i < 0 ? [...steps, step] : steps.map((x) => (x.id === step.id ? step : x)) };
          }),
      });
      patch((m) => ({ ...m, stats: result.stats, ...(result.cutOff ? { error: 'Stopped after too many tool calls in a row.' } : {}) }));
    } catch (e) {
      if (ac.signal.aborted) patch((m) => ({ ...m, stopped: true }));
      else patch((m) => ({ ...m, error: (e as Error).message }));
    } finally {
      setStreamingId(null);
      abortRef.current = null;
      ollama.refresh();
    }
  };

  /** `interactive` forces the setting for this send (used right after the first-use notice). */
  const send = (text: string, images: string[], files: Attachment[] = [], interactive?: boolean) => {
    if (!current || !activeModel || streamingId) return;
    // The first time interactive answers would be used, explain them before sending.
    if (interactive === undefined && isInteractive(current) && !noticeSeen) {
      setPendingSend({ text, images, files });
      return;
    }
    const user: UiMessage = { id: uid(), role: 'user', content: text, ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) };
    const title = current.messages.length === 0 ? text.slice(0, 48) || files[0]?.name || 'Image' : current.title;
    const conv = { ...current, title, ...(interactive !== undefined ? { interactive } : {}) };
    updateConv(current.id, (c) => ({ ...c, title, ...(interactive !== undefined ? { interactive } : {}) }));
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

  // Stable between renders, so widgets in earlier messages don't re-render on every streamed token.
  const sendRef = useRef(send);
  sendRef.current = send;
  const widgetActions = useMemo<WidgetActions>(() => ({
    ask: (text) => setComposerFill((f) => ({ text, n: (f?.n ?? 0) + 1 })),
    fix: (title, error) =>
      sendRef.current(
        `The "${title}" widget shows this error:\n\n${error}\n\nPlease find the cause and reply with the complete corrected \`\`\`widget block.`,
        [],
      ),
    busy: !!streamingId,
  }), [streamingId]);

  // Other views (the Orchestrator page) drive runs through this; the chat view stays mounted.
  chatController.current = {
    startOrchestration: (goal, model, folder) => {
      if (streamingId || !goal.trim() || !model) return null;
      const user: UiMessage = { id: uid(), role: 'user', content: goal.trim() };
      const conv: Conversation = { ...newConversation(model), title: goal.trim().slice(0, 48), agentId: ORCHESTRATOR_ID, folder, messages: [user] };
      setConversations((cs) => [conv, ...cs]);
      generate(conv, [user]);
      return conv.id;
    },
    runPlan,
    runInChat: async (convId, text, run) => {
      const conv = getConversations().find((c) => c.id === convId);
      if (!conv || streaming.get()) throw new Error('Another reply is running');
      const user: UiMessage = { id: uid(), role: 'user', content: text };
      await generate(conv, [...conv.messages, user], { ...run, fresh: true });
    },
    cancelPlan: (convId, msgId) => patchOrch(convId, msgId, (o) => ({ ...o, phase: 'cancelled' })),
    changePlan: (convId, msgId, plan) => patchOrch(convId, msgId, (o) => ({ ...o, plan })),
    stop: () => abortRef.current?.abort(),
    openChat: (convId) => setCurrentId(convId),
  };

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
          <InteractiveSwitch
            on={interactive}
            modelSize={ollama.models.find((m) => m.name === current.model)?.details.parameter_size}
            onChange={(on) => updateConv(current.id, (c) => ({ ...c, interactive: on }))}
          />
          <div className="topbar-center">
            <AgentPicker
              agents={agents}
              value={agent}
              orchestrator={current.agentId === ORCHESTRATOR_ID}
              onChange={(agentId) => updateConv(current.id, (c) => ({ ...c, agentId }))}
              onManage={onManageAgents}
            />
            {agent ? (
              <div className="agent-model" title="This agent's model. Change it in the Agents tab.">
                {agent.model || 'No model set'}
              </div>
            ) : (
              <ModelPicker
                ollama={ollama}
                value={current.model}
                keepAlive={params.keep_alive}
                numCtx={numCtx}
                onChange={(model) => updateConv(current.id, (c) => ({ ...c, model }))}
              />
            )}
          </div>
          <button className="icon-btn topbar-right" onClick={() => setShowSettings(!showSettings)} title="Toggle settings panel">
            {showSettings ? <PanelRightClose size={17} /> : <PanelRight size={17} />}
          </button>
        </header>

        <WidgetActionsContext.Provider value={widgetActions}>
        <PlanActionsContext.Provider value={planActions}>
        <Messages
          messages={current.messages}
          agents={agents}
          streaming={isStreaming}
          hasModel={!!activeModel}
          onRegenerate={regenerate}
          onDelete={deleteMessage}
          onEdit={editAndResend}
          onBranch={(id) => duplicateChat(current, id)}
        />
        </PlanActionsContext.Provider>
        </WidgetActionsContext.Provider>

        {pendingApproval && <ApprovalBar req={pendingApproval.req} onAnswer={pendingApproval.resolve} />}
        <Composer
          disabled={!activeModel}
          streaming={isStreaming}
          vision={caps.includes('vision')}
          onSend={send}
          onStop={() => abortRef.current?.abort()}
          onNewChat={createChat}
          fill={composerFill}
        />
      </main>

      {showSettings && (
        <SettingsPanel
          tools={
            <ChatTools
              agent={agent}
              tools={current.tools ?? DEFAULT_CHAT_TOOLS}
              setTools={(tools) => updateConv(current.id, (c) => ({ ...c, tools }))}
              folder={current.folder}
              setFolder={(folder) => updateConv(current.id, (c) => ({ ...c, folder }))}
              toolsSupported={caps.includes('tools')}
            />
          }
          params={params}
          setParams={(p) => setParams({ ...params, ...p })}
          systemPrompt={current.systemPrompt}
          setSystemPrompt={(systemPrompt) => updateConv(current.id, (c) => ({ ...c, systemPrompt }))}
          thinkingSupported={caps.includes('thinking')}
          contextTokens={(() => {
            const s = [...current.messages].reverse().find((m) => m.stats)?.stats;
            return s ? s.promptTokens + s.tokens : 0;
          })()}
          contextLimit={numCtx}
        />
      )}

      {pendingSend && (
        <InteractiveNotice
          onChoose={(keepOn) => {
            const { text, images, files } = pendingSend;
            setPendingSend(null);
            setNoticeSeen(true);
            send(text, images, files, keepOn);
          }}
        />
      )}
    </>
  );
}

type Attachment = { name: string; text: string };
const MAX_ATTACHMENT = 200 * 1024;
/** Attached files go to the model inside the message, capped so they can't flood the context. */
const MAX_ATTACHED_TOTAL = 60000;

function withFiles(m: UiMessage): string {
  if (!m.files?.length) return m.content;
  let room = MAX_ATTACHED_TOTAL;
  const blocks = m.files.map((f) => {
    const text = f.text.length > room ? `${f.text.slice(0, Math.max(0, room))}\n[…cut: the file has ${f.text.length.toLocaleString()} characters]` : f.text;
    room -= Math.min(room, f.text.length);
    return `<attached_file name="${f.name.replace(/"/g, "'")}">\n${text}\n</attached_file>`;
  });
  return `${blocks.join('\n\n')}\n\n${m.content}`;
}

function ApprovalBar({ req, onAnswer }: { req: ApprovalRequest; onAnswer: (a: Approval) => void }) {
  return (
    <div className="approval" role="alertdialog" aria-label={req.title}>
      <div className="approval-head"><ShieldAlert size={15} /> {req.title}</div>
      <pre className="approval-detail">{req.detail}</pre>
      {req.note && <div className="approval-note muted small">{req.note}</div>}
      <div className="row gap approval-actions">
        <button className="btn sm" onClick={() => onAnswer(false)}>Don't allow</button>
        <span className="flex" />
        {req.forRun && <button className="btn sm" onClick={() => onAnswer('run')}>{req.forRun}</button>}
        {req.always && <button className="btn sm" onClick={() => onAnswer('always')}>{req.always}</button>}
        <button className="btn sm primary" autoFocus onClick={() => onAnswer(true)}>{req.confirm ?? 'Allow'}</button>
      </div>
    </div>
  );
}

function ChatTools({ agent, tools, setTools, folder, setFolder, toolsSupported }: {
  agent?: Agent;
  tools: ToolGroup[];
  setTools: (t: ToolGroup[]) => void;
  folder?: string;
  setFolder: (f: string | undefined) => void;
  toolsSupported: boolean;
}) {
  const active = agent ? agent.tools : tools;
  const needsFolder = active.some((t) => TOOL_GROUPS.find((g) => g.id === t)?.needsFolder);
  const pick = async () => {
    const f = await host()?.tools.pickFolder();
    if (f) setFolder(f);
  };
  return (
    <section>
      <h4>Tools</h4>
      {!toolsSupported && <p className="net-note warn">This model can't use tools.</p>}
      {agent ? (
        <p className="net-note muted">Using {agent.name}'s tools: {active.map((t) => TOOL_GROUPS.find((g) => g.id === t)?.label).join(', ') || 'none'}.</p>
      ) : (
        TOOL_GROUPS.map((g) => (
          <label key={g.id} className={`check-row ${toolsSupported ? '' : 'dim'}`} title={g.description}>
            <input
              type="checkbox"
              checked={tools.includes(g.id)}
              disabled={!toolsSupported || !host()}
              onChange={(e) => setTools(e.target.checked ? [...tools, g.id] : tools.filter((t) => t !== g.id))}
            />
            <span>{g.label}{g.risky && <span className="muted small"> · asks first</span>}</span>
          </label>
        ))
      )}
      <div className="folder-row">
        <span className="muted small">Folder</span>
        {folder ? (
          <>
            <button className="link-btn mono folder-path" title={folder} onClick={() => host()?.tools.reveal(folder)}>{folder.split(/[\\/]/).slice(-2).join('/')}</button>
            <button className="icon-btn sm" title="Change folder" onClick={pick}><FolderOpen size={13} /></button>
            <button className="icon-btn sm" title="Remove folder" onClick={() => setFolder(undefined)}><X size={12} /></button>
          </>
        ) : (
          <button className={`btn sm ${needsFolder ? 'primary' : ''}`} onClick={pick} disabled={!host()}><FolderOpen size={13} /> Choose…</button>
        )}
      </div>
      {needsFolder && !folder && <p className="net-note warn">File and terminal tools need a folder.</p>}
    </section>
  );
}

function AgentPicker({ agents, value, orchestrator, onChange, onManage }: {
  agents: Agent[];
  value?: Agent;
  orchestrator: boolean;
  onChange: (agentId: string | undefined) => void;
  onManage: () => void;
}) {
  const menu = useContextMenu();
  return (
    <button
      className={`agent-picker ${value || orchestrator ? 'on' : ''}`}
      title={orchestrator ? 'The orchestrator plans the work and assigns tasks to agents. The model next to it does the planning.' : value ? `Replies come from the ${value.name} agent` : 'Pick an agent or the orchestrator for this chat'}
      onClick={(e) =>
        menu(e, [
          { label: 'No agent (just the model)', icon: value || orchestrator ? undefined : Check, onClick: () => onChange(undefined) },
          { label: 'Orchestrator: plans and assigns tasks to agents', icon: orchestrator ? Check : Workflow, onClick: () => onChange(ORCHESTRATOR_ID) },
          agents.length > 0 && 'separator',
          ...agents.map((a) => ({ label: `${a.name}${a.model ? `  ·  ${a.model}` : ''}`, icon: a.id === value?.id ? Check : Bot, onClick: () => onChange(a.id) })),
          'separator',
          { label: 'Manage agents…', icon: Pencil, onClick: onManage },
        ])
      }
    >
      {orchestrator ? <Workflow size={14} /> : <Bot size={14} />}
      <span>{orchestrator ? 'Orchestrator' : value ? value.name : 'No agent'}</span>
      <ChevronDown size={13} />
    </button>
  );
}

/** Parses Ollama's parameter_size ("7.6B", "350M") into billions. */
function billions(size?: string): number | null {
  const m = /^([\d.]+)\s*([BM])$/i.exec(size ?? '');
  if (!m) return null;
  return parseFloat(m[1]) / (m[2].toUpperCase() === 'M' ? 1000 : 1);
}

function InteractiveSwitch({ on, modelSize, onChange }: { on: boolean; modelSize?: string; onChange: (on: boolean) => void }) {
  const b = billions(modelSize);
  const small = on && b !== null && b < 7;
  return (
    <div className="ia-wrap">
      <button
        className={`ia-switch ${on ? 'on' : ''}`}
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        title={on
          ? 'Interactive answers are ON: the model can reply with live charts, calculators, and diagrams. Click to turn off for this chat.'
          : 'Interactive answers are OFF: replies are text only. Click to turn on for this chat.'}
      >
        <Sparkles size={14} />
        <span className="ia-label">Interactive</span>
        <span className="ia-track"><span className="ia-thumb" /></span>
      </button>
      {small && <span className="ia-hint" title="Small models often write broken widgets. 7B or larger works best.">best with 7B+</span>}
    </div>
  );
}

function InteractiveNotice({ onChoose }: { onChoose: (keepOn: boolean) => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ia-notice-title">
        <div className="modal-icon"><Sparkles size={22} /></div>
        <h3 id="ia-notice-title">Interactive answers are on</h3>
        <p>
          The model can reply with small apps, like charts, calculators, diagrams, and 3D views, that run right in the chat.
        </p>
        <ul>
          <li><b>They run in a sandbox.</b> A widget can't read your chats or files or talk to Ollama.</li>
          <li><b>Internet is limited.</b> Widgets can download from approved sites like maps and weather data. Any other site asks you first, and widgets can never upload or post.</li>
          <li><b>The model writes the code,</b> so widgets can have mistakes. Numbers in them may be examples, not real data.</li>
          <li><b>Replies take longer</b> and use more of the model's context. Larger models (7B+) do this much better.</li>
        </ul>
        <p className="muted small">You can turn this on or off for each chat with the <b>Interactive</b> switch at the top.</p>
        <div className="modal-actions">
          <button className="btn" onClick={() => onChoose(false)}>Turn off for this chat</button>
          <button className="btn primary" autoFocus onClick={() => onChoose(true)}>Keep it on</button>
        </div>
      </div>
    </div>
  );
}

function Messages(props: {
  messages: UiMessage[];
  agents: Agent[];
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
            agentName={m.agentId === ORCHESTRATOR_ID ? 'Orchestrator' : m.agentId ? props.agents.find((a) => a.id === m.agentId)?.name : undefined}
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

function MessageView({ msg, agentName, live, busy, onRegenerate, onDelete, onEdit, onBranch }: {
  msg: UiMessage;
  agentName?: string;
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
  const stillThinking = live && !answer && !msg.steps?.some((s) => s.status === 'running');
  // Step offsets index into msg.content, which is the answer unless reasoning was inline (<think>).
  const interleave = !!msg.steps?.length && answer === msg.content;
  const parts = interleave ? interleaved(answer, msg.steps!).length : 0;

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
      <div className="msg-role">
        {msg.role === 'user' ? 'You' : agentName ? <><Bot size={12} /> {agentName} <span className="muted">· {msg.model}</span></> : msg.model ?? 'Assistant'}
      </div>
      {msg.images?.length ? (
        <div className="msg-images">
          {msg.images.map((b64, i) => (
            <img key={i} src={`data:image/*;base64,${b64}`} alt="" />
          ))}
        </div>
      ) : null}
      {thinking && <Thinking text={thinking} active={stillThinking} />}
      {msg.orchestration && <PlanCard msgId={msg.id} orch={msg.orchestration} />}
      {msg.steps?.length && !interleave ? <Steps steps={msg.steps} /> : null}
      {editing ? (
        <div className="msg-edit">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(12, draft.split('\n').length + 1)} autoFocus />
          <div className="row gap">
            <button className="btn primary sm" onClick={() => { setEditing(false); onEdit(draft); }}>Save & resend</button>
            <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : msg.role === 'user' ? (
        <div className="msg-body user-text">
          {msg.files?.length ? (
            <div className="msg-files">
              {msg.files.map((f, i) => <span key={i} className="file-chip" title={`${f.text.length.toLocaleString()} characters`}><FileText size={12} /> {f.name}</span>)}
            </div>
          ) : null}
          {msg.content}
        </div>
      ) : (
        <div className="msg-body">
          {interleave ? (
            interleaved(answer, msg.steps!).map((part, i) =>
              typeof part === 'string' ? <Markdown key={i} text={part} live={live && i === parts - 1} /> : <Steps key={i} steps={part} />,
            )
          ) : answer ? (
            <Markdown text={answer} live={live} />
          ) : live && !thinking ? (
            <span className="typing"><i /><i /><i /></span>
          ) : null}
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

/** Splits a reply into text and the tool steps that ran between its parts. */
function interleaved(text: string, steps: Step[]): (string | Step[])[] {
  const out: (string | Step[])[] = [];
  let pos = 0;
  for (const s of steps) {
    const at = Math.min(s.at ?? 0, text.length);
    if (at > pos) out.push(text.slice(pos, at));
    pos = Math.max(pos, at);
    const last = out[out.length - 1];
    if (Array.isArray(last)) last.push(s);
    else out.push([s]);
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
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

function Composer({ disabled, streaming, vision, onSend, onStop, onNewChat, fill }: {
  disabled: boolean;
  streaming: boolean;
  vision: boolean;
  onSend: (text: string, images: string[], files: Attachment[]) => void;
  onStop: () => void;
  onNewChat: () => void;
  fill: { text: string; n: number } | null;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fit = () => {
      const ta = taRef.current;
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [text]);

  // A widget's follow-up question lands here for the user to review, edit, or send.
  useEffect(() => {
    if (!fill) return;
    setText(fill.text);
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      requestAnimationFrame(() => ta.setSelectionRange(ta.value.length, ta.value.length));
    }
  }, [fill?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!taRef.current?.offsetParent) return; // the chat view is hidden behind another tab
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onNewChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNewChat]);

  const addFiles = async (list: FileList | File[]) => {
    const all = [...list];
    const problems: string[] = [];
    const texts: Attachment[] = [];
    for (const f of all.filter((f) => !f.type.startsWith('image/'))) {
      if (f.size > MAX_ATTACHMENT) {
        problems.push(`${f.name} is too large (max ${MAX_ATTACHMENT / 1024} KB)`);
        continue;
      }
      const text = await f.text();
      if (text.slice(0, 8000).includes('\u0000')) problems.push(`${f.name} isn't a text file`);
      else texts.push({ name: f.name, text });
    }
    if (!vision && all.some((f) => f.type.startsWith('image/'))) problems.push("This model can't see images");
    setAttachError(problems.join(' · '));
    setFiles((fs) => [...fs, ...texts]);
    const encoded = await Promise.all(
      all.filter((f) => vision && f.type.startsWith('image/')).map(
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

  const empty = !text.trim() && !images.length && !files.length;
  const submit = () => {
    if (disabled || streaming || empty) return;
    onSend(text.trim(), images, files);
    setText('');
    setImages([]);
    setFiles([]);
    setAttachError('');
  };

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${disabled ? 'disabled' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        {(files.length > 0 || attachError) && (
          <div className="composer-files">
            {files.map((f, i) => (
              <span key={i} className="file-chip">
                <FileText size={12} /> {f.name}
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} title="Remove"><X size={11} /></button>
              </span>
            ))}
            {attachError && <span className="attach-error">{attachError}</span>}
          </div>
        )}
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
          onPaste={(e) => e.clipboardData.files.length && addFiles(e.clipboardData.files)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-bar">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            className="icon-btn"
            title={vision ? 'Attach images or text files' : 'Attach text files (this model does not support images)'}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={16} />
          </button>
          <span className="flex" />
          {streaming ? (
            <button className="send-btn stop" onClick={onStop} title="Stop generating"><Square size={14} fill="currentColor" /></button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={disabled || empty} title="Send (Enter)">
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ tools, params, setParams, systemPrompt, setSystemPrompt, thinkingSupported, contextTokens, contextLimit }: {
  tools: ReactNode;
  params: GenParams;
  setParams: (p: Partial<GenParams>) => void;
  systemPrompt: string;
  setSystemPrompt: (s: string) => void;
  thinkingSupported: boolean;
  contextTokens: number;
  contextLimit: number;
}) {
  const ctxUsed = Math.min(100, (contextTokens / contextLimit) * 100);
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
            <span className="muted mono">{contextTokens.toLocaleString()} / {contextLimit.toLocaleString()} tokens</span>
          </div>
        </section>

        {tools}

        <WidgetInternet />

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

function WidgetInternet() {
  const net = useNetSettings();
  const [confirmAll, setConfirmAll] = useState(false);
  const [showList, setShowList] = useState(false);
  return (
    <section>
      <h4>Internet access</h4>
      <label className="field">
        <span>Access</span>
        <select value={net.mode} onChange={(e) => (e.target.value === 'all' ? setConfirmAll(true) : setNetMode('ask'))}>
          <option value="ask">Approved sites, ask for others</option>
          <option value="all">Whole internet</option>
        </select>
      </label>
      {net.mode === 'all' ? (
        <p className="net-note warn"><TriangleAlert size={12} /> Widgets and agents can reach any site without asking.</p>
      ) : (
        <p className="net-note muted">
          For widgets and agents' web tools. Maps, CDNs, and public data work right away; other sites ask first.{' '}
          <button className="link-btn" onClick={() => setShowList(!showList)}>{showList ? 'Hide list' : 'See list'}</button>
        </p>
      )}
      {showList && net.mode === 'ask' && (
        <div className="net-list">
          {APPROVED_SITES.map((g) => (
            <div key={g.group}><b>{g.group}</b><div className="mono">{g.hosts.join(', ')}</div></div>
          ))}
        </div>
      )}
      {net.alwaysAllow.length > 0 && (
        <div className="net-list">
          <b>Always allowed by you</b>
          {net.alwaysAllow.map((h) => (
            <div key={h} className="row net-allowed">
              <span className="mono flex">{h}</span>
              <button className="icon-btn sm" title={`Stop always allowing ${h}`} onClick={() => removeAlwaysAllowed(h)}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {confirmAll && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="net-all-title">
            <div className="modal-icon warn"><Globe size={22} /></div>
            <h3 id="net-all-title">Let widgets and agents reach the whole internet?</h3>
            <p>Widgets and agents are driven by the model. With this on, widgets can load from any https website and agents can open any page, without asking you.</p>
            <ul>
              <li><b>The model could send small pieces of your conversation to a website</b> inside a web address. This is most likely if you paste text, documents, or pages you don't trust, since they can trick the model.</li>
              <li><b>Still blocked:</b> uploads and posts, cookies, your computer and local network, and Ollama.</li>
              <li>You can see every request in each widget's network log and each agent's steps.</li>
            </ul>
            <div className="modal-actions">
              <button className="btn primary" autoFocus onClick={() => setConfirmAll(false)}>Keep approved sites only</button>
              <button className="btn danger" onClick={() => { setNetMode('all'); setConfirmAll(false); }}>Allow whole internet</button>
            </div>
          </div>
        </div>
      )}
    </section>
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
