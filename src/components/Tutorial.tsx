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
  { title: 'Welcome to Penumbra', body: 'A quick tour of what you can do: chat with local models, get live interactive answers, build agents, plan work with the orchestrator, schedule tasks, and make images. Everything runs on this computer with Ollama.' },
  { title: 'Pick a model', body: 'Choose which Ollama model answers (⌘/Ctrl+L). It loads into memory when you pick it. Badges show what each model can do, like vision, tools, or reasoning.', target: '.picker-btn', view: 'chat' },
  { title: 'Interactive answers', body: 'With this on, the model can reply with small live apps: calculators, charts, maps, diagrams. Turn it off for plain text, per chat.', target: '.ia-switch', view: 'chat' },
  { title: 'Ask anything', body: 'Type here and press Enter. Attach images for vision models, or text files like notes and CSVs. Ask for a picture and the model can create one with your image model.', target: '.composer', view: 'chat' },
  { title: 'Chat settings', body: 'This button opens the panel with the system prompt, the tools a chat may use (web, files, terminal, images), a folder for file tools, and sampling settings.', target: '.view-host .topbar-right', view: 'chat' },
  { title: 'Orchestrator', body: 'Give it a goal. It plans the tasks, creates the agents it needs, lets you review the plan, then runs it and writes the final answer.', target: '.rail-btn[title="Orchestrator"]' },
  { title: 'Scheduler', body: 'Run prompts, agents, orchestrator goals, or commands at set times or on repeat. Each task keeps its results and a run log.', target: '.rail-btn[title="Scheduler"]' },
  { title: 'Agents & Skills', body: 'Create agents with a purpose, a persona, an avatar, and their own tools. Skills are packaged instructions the model loads when a task needs them.', target: '.rail-btn[title="Agents & Skills"]' },
  { title: 'Images', body: 'Make pictures on this computer, outside Ollama, with image models from Hugging Face. The next steps show how.', target: '.rail-btn[title="Images"]' },
  { title: 'Find image models', body: 'Search Hugging Face for image models. Penumbra checks each file before you download it: Z-Image and FLUX.1 work today. Models marked 18+ stay hidden unless you choose to show them.', target: '.page-head .seg button:last-child', view: 'images' },
  { title: 'Create', body: 'Write a prompt, pick a size, and Generate. Steps and seed are optional. Images are saved in Pictures/Penumbra (change it with Change…), and recent ones show below with their prompt.', target: '.images-create > .panel:first-child, .images-empty', view: 'images' },
  { title: 'Your image models', body: 'See what you downloaded and delete what you no longer need. The first model of a family also gets the image engine and a few shared files, so the next ones are smaller.', target: '.page-head .seg button:nth-child(2)', view: 'images' },
  { title: 'Images everywhere', body: 'Ask for a picture in any chat, or give an agent the Images tool, and it appears in the reply (saved in the chat’s folder if it has one). Click any image to zoom, pan, and copy its prompt. Generate… in an avatar menu makes an avatar.' },
  { title: 'Models', body: 'My Models shows what you have installed and what is loaded. Discover finds new models in the Ollama library and on Hugging Face.', target: '.rail-btn[title="Discover"]' },
  { title: 'Your profile', body: 'Your name and avatar, and your profiles: each one keeps its own chats, agents, and settings, and can have a password.', target: '.rail-profile' },
  { title: 'Options', body: 'Server connection, internet access for widgets and agents, the guided demo, updates, and this tutorial, whenever you want it again.', target: '.rail-btn[title="Options"]' },
  { title: "You're all set", body: 'Start a chat, or open Options → Guided demo for a step-by-step tour with real examples. Have fun!' },
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

  // Place the card next to what it describes: right of the sidebar, below the top bar, or above the composer.
  const PAD = 8;
  const W = 340;
  let style: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.max(16, Math.min(vw - W - 16, x));
    if (rect.left < 90) style = { left: rect.right + 18, top: Math.max(16, Math.min(vh - 260, rect.top - 10)) };
    else if (rect.top < 160) style = { left: clampX(rect.left + rect.width / 2 - W / 2), top: rect.bottom + 16 };
    else style = { left: clampX(rect.left + rect.width / 2 - W / 2), bottom: vh - rect.top + 16 };
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
