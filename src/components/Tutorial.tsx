// A short guided tour of the app: each step highlights a part of the screen and explains it. It opens at
// startup until the user clicks "Don't show again". The choice is saved per profile, so every new profile
// sees it once. Options → Tutorial opens it again.
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { X } from './icons';

const KEY = 'ollama-gui.tutorial';

/** Shown at startup unless the user chose "Don't show again" (in this profile). */
export const tutorialAtStart = () => {
  try {
    return localStorage.getItem(KEY) !== 'hidden';
  } catch {
    return false;
  }
};
export const setTutorialAtStart = (on: boolean) => {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'hidden');
  } catch {
    /* storage unavailable */
  }
  emit();
};

let open = tutorialAtStart();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const openTutorial = () => {
  open = true;
  emit();
};
const closeTutorial = () => {
  open = false;
  emit();
};
const useOpen = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => open);

interface Step {
  title: string;
  body: string;
  /** What to highlight; none means a card in the middle. */
  target?: string;
  /** The tab the target lives on. */
  view?: string;
}

const STEPS: Step[] = [
  { title: 'Welcome to Penumbra', body: 'A tour of every tab: chat with local models, interactive answers, agents, the orchestrator, scheduled tasks, images, and your options. Everything runs on this computer with Ollama.' },

  // Chat
  { title: 'Your chats', body: 'Every chat is saved here. + starts a new one (⌘/Ctrl+N). Right-click a chat to rename, duplicate, export it as Markdown, move it to another profile, or delete it.', target: '.view-host aside.sidebar', view: 'chat' },
  { title: 'Agent or orchestrator', body: 'Answer with the plain model, one of your agents, or the orchestrator, which splits a goal into tasks for several agents.', target: '.view-host .agent-picker', view: 'chat' },
  { title: 'Pick a model', body: 'Choose which Ollama model answers (⌘/Ctrl+L). It loads into memory when you pick it. Badges show what each model can do, like vision, tools, or reasoning.', target: '.picker-btn', view: 'chat' },
  { title: 'Interactive answers', body: 'With this on, the model can reply with small live apps: calculators, charts, maps, diagrams. Turn it off for plain text, per chat.', target: '.ia-switch', view: 'chat' },
  { title: 'Ask anything', body: 'Type here and press Enter. Attach images for vision models, or text files like notes and CSVs. Ask for a picture and the model can create one with your image model.', target: '.composer', view: 'chat' },
  { title: 'Chat settings', body: 'This button opens the panel with the system prompt, the tools a chat may use (web, files, terminal, images), a folder for file tools, this chat’s internet access, and sampling settings.', target: '.view-host .topbar-right', view: 'chat' },

  // Orchestrator
  { title: 'Orchestrator runs', body: 'Every orchestrator run is listed here. + starts a new one.', target: '.content-inner > aside.sidebar', view: 'orchestrator' },
  { title: 'Plan, review, run', body: 'Describe a goal and pick the planner model. The orchestrator proposes tasks and the agents for them (creating new ones if needed). You edit and approve the plan, then follow it on a board with a column per agent, and get the final answer.', target: '.content-inner > main', view: 'orchestrator' },

  // Scheduler
  { title: 'Scheduled tasks', body: 'New task runs a prompt, an agent, an orchestrator goal, or a terminal command once, daily or on chosen days, or every few minutes or hours. Each task keeps its own chat and a run log.', target: 'button[title="New task"]', view: 'scheduler' },
  { title: 'While tasks are on', body: 'Penumbra can stay in the menu bar when you close the window, so tasks run on time, and notify you when one finishes or needs your OK.', target: '.content-inner > main .panel:last-child', view: 'scheduler' },

  // Agents & Skills
  { title: 'Your agents', body: 'Each agent is a card: avatar, purpose, persona, model, and the tools it may use. Edit opens its page; Chat starts a conversation with it.', target: '.tcards, .agents-empty', view: 'agents' },
  { title: 'New agent', body: 'A short wizard: a purpose, a name, a persona (personality and style), an avatar, and a model. Templates like Researcher or Coder are a quick start.', target: '.list-new', view: 'agents' },
  { title: 'Skills', body: 'Skills are packaged instructions (the SKILL.md format). Create them here or import folders and .zip files; the model loads one only when a task needs it.', target: '.content-inner > aside .sidebar-head .seg button:last-child', view: 'agents' },

  // Images
  { title: 'Find image models', body: 'Make pictures on this computer, outside Ollama. Search Hugging Face for image models: Penumbra checks each file before you download it (Z-Image and FLUX.1 work today). Models marked 18+ stay hidden unless you choose to show them.', target: '.page-head .seg button:last-child', view: 'images' },
  { title: 'Create', body: 'Write a prompt, pick a size, and Generate. Steps and seed are optional. Images are saved in Pictures/Penumbra (change it with Change…), and recent ones show below with their prompt.', target: '.images-create > .panel:first-child, .images-empty', view: 'images' },
  { title: 'Your image models', body: 'See what you downloaded and delete what you no longer need. The first model of a family also gets the image engine and a few shared files, so the next ones are smaller.', target: '.page-head .seg button:nth-child(2)', view: 'images' },
  { title: 'Images everywhere', body: 'Ask for a picture in any chat, or give an agent the Images tool, and it appears in the reply (saved in the chat’s folder if it has one). Click any image to zoom, pan, and copy its prompt. Generate… in an avatar menu makes an avatar.' },

  // Models
  { title: 'My Models', body: 'Everything you have installed, and what is loaded in memory right now with how much it uses. Load, eject, or delete models, and see their details.', target: '.content-inner > main', view: 'models' },
  { title: 'Discover', body: 'Find new models in the Ollama library or on Hugging Face (pick a quantization). Downloads can be paused and resumed, and survive restarts.', target: '.discover-tabs', view: 'discover' },

  // Profile
  { title: 'Your profile', body: 'Your name and avatar, and your profiles: each one keeps its own chats, agents, and settings, can have a password, and ★ picks the one that opens at startup.', target: '.rail-profile' },

  // Options
  { title: 'Server', body: 'Where Penumbra finds Ollama. Change it to use Ollama on another computer.', target: '#server', view: 'developer' },
  { title: 'Internet access', body: 'The default for all chats: which sites widgets and agents may reach without asking. Add your own sites, or allow the whole internet (with a warning first). Each chat can change this in its settings panel.', target: '#internet-access', view: 'developer' },
  { title: 'Guided demo', body: 'A longer, step-by-step tour with real examples, in its own window with sample data, so your chats aren’t touched.', target: '#demo', view: 'developer' },
  { title: 'This tutorial', body: 'Open it again any time from here, and choose whether it shows when Penumbra starts.', target: '#tutorial', view: 'developer' },
  { title: "You're all set", body: 'Start a chat, or open Options → Guided demo for a step-by-step tour with real examples. Have fun!', view: 'chat' },
];

/** Mounted once in the app; `setView` switches tabs so each step's target is on screen. */
export function Tutorial({ setView }: { setView: (v: string) => void }) {
  const isOpen = useOpen();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];

  useEffect(() => {
    if (isOpen) setI(0);
  }, [isOpen]);

  // Go to the step's tab, then find what to highlight (once the tab has rendered).
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (step.view) setView(step.view);
    let frame = 0;
    const find = () => {
      const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
      setRect(el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
    };
    frame = requestAnimationFrame(() => requestAnimationFrame(find));
    window.addEventListener('resize', find);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', find);
    };
  }, [isOpen, i]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTutorial();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(STEPS.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen]);

  if (!isOpen) return null;
  const last = i === STEPS.length - 1;
  const neverAgain = () => {
    setTutorialAtStart(false);
    closeTutorial();
  };

  // Place the card next to what it describes: beside the sidebar icons; otherwise below, above, beside, or (for
  // big areas) inside the highlighted part, wherever it fits.
  const PAD = 8;
  const W = 340;
  const H = 280;
  let style: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.max(16, Math.min(vw - W - 16, x));
    const clampY = (y: number) => Math.max(16, Math.min(vh - H - 16, y));
    const centerX = clampX(rect.left + rect.width / 2 - W / 2);
    if (rect.left < 90 && rect.width < 120) style = { left: rect.right + 18, top: clampY(rect.top - 10) };
    else if (vh - rect.bottom > H + 24) style = { left: centerX, top: rect.bottom + 16 };
    else if (rect.top > H + 24) style = { left: centerX, bottom: vh - rect.top + 16 };
    else if (vw - rect.right > W + 24) style = { left: rect.right + 16, top: clampY(rect.top) };
    else if (rect.left > W + 24) style = { left: rect.left - W - 16, top: clampY(rect.top) };
    else style = { left: clampX(rect.right - W - 24), top: clampY(rect.top + 24) };
  }

  return (
    <div className="tutorial" role="dialog" aria-label="Tutorial">
      {rect ? (
        <div className="tut-hole" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
      ) : (
        <div className="tut-dim" />
      )}
      <div className={`tut-card ${rect ? '' : 'center'}`} style={style}>
        <div className="tut-head">
          <span className="tut-count">{i + 1} / {STEPS.length}</span>
          <button className="icon-btn sm" title="Close for now (Esc)" onClick={closeTutorial}><X size={14} /></button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tut-dots">
          {STEPS.map((_, n) => <button key={n} className={n === i ? 'on' : ''} aria-label={`Step ${n + 1}`} onClick={() => setI(n)} />)}
        </div>
        <div className="tut-actions">
          <button className="link-btn small" onClick={neverAgain}>Don’t show again</button>
          <span className="flex" />
          {i > 0 && <button className="btn sm" onClick={() => setI(i - 1)}>Back</button>}
          {last ? <button className="btn primary sm" onClick={closeTutorial}>Done</button> : <button className="btn primary sm" autoFocus onClick={() => setI(i + 1)}>{i === 0 ? 'Start tour' : 'Next'}</button>}
        </div>
      </div>
    </div>
  );
}
