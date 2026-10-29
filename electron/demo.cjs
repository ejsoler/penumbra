// The guided demo (docs/DEMO.md), started from the Developer tab. It opens a separate window with its own
// storage, skills folder, and demo files, so your chats, agents, and skills are never touched. A panel
// in that window shows the next step; nothing happens until "Next" is clicked.
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { setSkillsFolder } = require('./skills.cjs');

const DEMO_FILES = path.join(__dirname, '..', 'docs', 'demo');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fs.cpSync doesn't read from the app's asar archive; this does. */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.writeFileSync(b, fs.readFileSync(a));
  }
}

/** A fresh demo folder each time: skills, and the workspace the Coder works in. */
function prepareFiles() {
  const base = path.join(app.getPath('userData'), 'demo');
  fs.rmSync(base, { recursive: true, force: true });
  const skills = path.join(base, 'skills');
  copyDir(path.join(DEMO_FILES, 'skills'), skills);
  fs.mkdirSync(path.join(skills, 'haiku-mode'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'haiku-mode', 'SKILL.md'), '---\nname: haiku-mode\ndescription: Use when the user asks for a poem.\n---\nAlways answer with a single haiku (5-7-5 syllables), nothing else.\n');
  const folder = path.join(base, 'penumbra-demo');
  copyDir(path.join(DEMO_FILES, 'workspace'), folder);
  return { skills, folder, notes: fs.readFileSync(path.join(DEMO_FILES, 'notes.txt'), 'utf8') };
}

function seed(model, folder) {
  const agent = (id, name, description, instructions, tools) => ({ id, name, description, model, instructions, skills: [], tools, createdAt: 1 });
  const agents = [
    agent('res', 'Researcher', 'Gathers facts and explains them clearly, with sources when it has them.', 'You are a careful researcher. Search the web for current or specific facts, read the most relevant pages, and answer with well-organized findings and the addresses you used. Say clearly when you are unsure, and never invent sources or numbers.', ['skills', 'web']),
    agent('wri', 'Writer', 'Drafts and edits text: emails, posts, summaries, documents.', 'You are a skilled writer and editor. Match the requested tone and length. Prefer clear, plain language. Return the finished text without commentary unless asked.', ['skills']),
    agent('cod', 'Coder', 'Writes, explains, and reviews code.', "You are an expert programmer. Look at the existing files before changing anything, write correct, idiomatic code that matches the project's style, and test it when you can. Explain briefly what you changed.", ['skills', 'files', 'write', 'terminal']),
  ];
  const chats = [
    { title: 'Demo · Interactive', interactive: true },
    { title: 'Demo · Internet', interactive: true },
    { title: 'Demo · Writer', agentId: 'wri' },
    { title: 'Demo · Poem' },
    { title: 'Demo · Coder', agentId: 'cod', folder },
    { title: 'Demo · Researcher', agentId: 'res' },
    { title: 'Demo · Attachment' },
    { title: 'Demo · Orchestrator', agentId: 'orchestrator' },
    { title: 'Demo · Story' },
  ].map((c, i) => ({ id: 'demo' + i, model, systemPrompt: '', messages: [], updatedAt: 100 - i, interactive: false, ...c }));
  const tomorrow8 = new Date();
  tomorrow8.setDate(tomorrow8.getDate() + 1);
  tomorrow8.setHours(8, 0, 0, 0);
  const tasks = [{
    id: 'demo-task', name: 'Morning haiku', enabled: true, kind: 'prompt', model, preApproved: [],
    prompt: 'Write one haiku about the morning. Only the haiku.', schedule: { type: 'daily', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] },
    nextRun: tomorrow8.getTime(), createdAt: Date.now(),
  }];
  return { agents, chats, tasks };
}

let demo = null; // the open demo window

async function runDemo(win, model) {
  const wc = win.webContents;
  const alive = () => !win.isDestroyed();
  const js = (code) => (alive() ? wc.executeJavaScript(code) : Promise.reject(new Error('closed')));
  const { skills, folder, notes } = prepareFiles();
  setSkillsFolder(wc, skills);
  const { agents, chats, tasks } = seed(model, folder);
  const str = (v) => JSON.stringify(JSON.stringify(v));

  await new Promise((r) => wc.once('did-finish-load', r));
  await js(`localStorage.clear();
    localStorage.setItem('ollama-gui.view', '"chat"');
    localStorage.setItem('ollama-gui.showSettings', 'false');
    localStorage.setItem('ollama-gui.interactiveNoticeSeen', 'true');
    localStorage.setItem('ollama-gui.params', JSON.stringify({ think: false }));
    localStorage.setItem('ollama-gui.workspaceModel', ${str(model)});
    localStorage.setItem('ollama-gui.updates', JSON.stringify({ auto: false, skipped: '' }));
    localStorage.setItem('ollama-gui.agents', ${str(agents)});
    localStorage.setItem('ollama-gui.conversations', ${str(chats)});
    localStorage.setItem('ollama-gui.schedule', ${str(tasks)});
    location.reload();`);
  await new Promise((r) => wc.once('did-finish-load', r));
  await sleep(1500);

  // ---- acting in the app ----
  const view = (title) => js(`document.querySelector('.rail-btn[title="${title}"]').click()`).then(() => sleep(500));
  const openChat = async (title) => {
    await view('Chat');
    await js(`[...document.querySelectorAll('.view-host .conv-item')].find(e => e.querySelector('.conv-title')?.textContent === ${JSON.stringify(title)}).click()`);
    await sleep(600);
  };
  const checkModel = async () => {
    const m = await js(`(document.querySelector('.view-host .agent-model') || document.querySelector('.view-host .picker-btn'))?.innerText || ''`);
    if (!m.includes(model)) throw new Error(`This chat isn't using ${model} (${m.trim()}), so nothing was sent.`);
  };
  const type = async (selector, text) => {
    const set = (t) => js(`(() => { const ta = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(t)}); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    for (let i = 1; i < text.length; i += 3) {
      await set(text.slice(0, i));
      await sleep(12);
    }
    await set(text);
  };
  const waitDone = async () => {
    for (let t = 0; t < 900; t++) {
      await sleep(1000);
      if (t > 2 && !(await js(`!!document.querySelector('.view-host .send-btn.stop')`))) return;
    }
  };
  const send = async (text, { wait = true } = {}) => {
    await checkModel();
    await type('.view-host .composer textarea', text);
    await sleep(300);
    await js(`document.querySelector('.view-host .send-btn').click()`);
    if (wait) await waitDone();
  };
  // Only visible buttons: the chat stays mounted (hidden) on other tabs.
  const clickText = (text) => js(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.innerText.trim().startsWith(${JSON.stringify(text)}) && !b.disabled).pop(); if (b) b.click(); return !!b; })()`);
  const waitFor = async (code, secs = 300) => {
    for (let t = 0; t < secs; t++) {
      if (await js(code)) return true;
      await sleep(1000);
    }
    return false;
  };
  /** A plan runs only if every agent in it uses the demo's model. */
  const runPlan = async () => {
    const bad = await js(`[...document.querySelectorAll('select')].filter(s => s.offsetParent && [...s.options].some(o => o.value === ${JSON.stringify(model)}) && s.value && s.value !== ${JSON.stringify(model)}).map(s => s.value)`);
    if (bad.length) throw new Error(`The plan uses another model (${bad.join(', ')}). Change it to ${model}, then click Retry.`);
    if (!(await clickText('Run plan'))) throw new Error("Couldn't find the Run plan button.");
  };
  const page = '.content-inner > :not(.view-host)';

  const STEPS = [
    { t: 'Welcome', say: `A tour of Penumbra, one step at a time. This window is separate: its chats, agents, and skills are demo copies, and closing it deletes them. Every reply uses ${model}. Click Next to start.` },
    { s: '1. Interactive answers', t: 'Temperature converter', say: 'Sends a prompt in a chat with Interactive on: the model answers with a small live app (about 30 seconds).', run: async () => { await openChat('Demo · Interactive'); await send('Make me a simple tool to convert temperatures between Celsius and Fahrenheit, with a slider.'); } },
    { t: 'Try it', say: 'Drag the slider. In the widget toolbar: View code, Save as HTML, and full screen (Esc closes it). Click Next when you’re ready.' },
    { t: 'A simple question', say: 'For a simple fact, the model just answers in text.', run: () => send('What is the capital of Japan?') },
    { s: '2. Explanations and fixes', t: 'Phases of the moon', say: 'An explanation you can play with (about a minute).', run: () => send('Show me how the phases of the moon work, with a slider and a play button.') },
    { t: 'Ask model to fix', say: 'If a widget ever shows a red error bar, click "Ask model to fix". Otherwise, go on.' },
    { s: '3. Widgets with internet', t: 'Earthquake map', say: 'Real USGS data (about 35 seconds).', run: async () => { await openChat('Demo · Internet'); await send('Show me a map of the earthquakes of magnitude 4.5 or more in the past week.'); } },
    { t: 'Network log', say: 'Click the 🌐 number in the widget toolbar: every request is listed. Widgets can only download, never upload.' },
    { t: 'Old San Juan', say: 'Markers appear a few seconds after the map: it looks the places up on OpenStreetMap.', run: () => send('Show me a map of Old San Juan, Puerto Rico with markers for El Morro, Castillo San Cristóbal, and La Fortaleza.') },
    { t: 'Weather in Madrid', run: () => send("What's the weather forecast for the next 5 days in Madrid? Show it as a chart.") },
    { t: 'A new site', say: 'CoinGecko isn’t on the approved list, so the widget asks first. Click "Allow" and the price appears.', run: () => send('Show the current price of Bitcoin in USD from the CoinGecko API.') },
    { t: 'Internet access', say: 'Open the settings panel (right) → Internet access. Look at "See list", and note that "Whole internet" warns first. Leave it on Approved sites.' },
    { s: '4. Agents and skills', t: 'Agents', say: 'Writer, Coder, and Researcher are ready, all using the demo model.', run: () => view('Agents & Skills') },
    { t: 'Skills', say: 'Open company-memo and its file templates/memo.md. haiku-mode is installed too.', run: () => clickText('Skills') },
    { t: 'A memo with a skill', say: 'The Writer loads company-memo on its own: watch for the Load skill and Read skill file steps.', run: async () => { await openChat('Demo · Writer'); await send('Write a memo telling the team the office is closed this Friday for maintenance.'); } },
    { t: 'Poem → haiku', say: 'No agent: it loads haiku-mode and answers with a haiku.', run: async () => { await openChat('Demo · Poem'); await send('Write me a short poem about the sea.'); } },
    { s: '5. Tools', t: 'Coder with a folder', say: 'Reads data.csv, writes summary.py, and asks before running it. When the bar appears, click "Run". The answer is 84.5.', run: async () => { await openChat('Demo · Coder'); await send('Read data.csv, then write a Python script summary.py that prints the average of the score column, and run it with python3.'); } },
    { t: 'Saying no', say: 'When it asks to run ls -la, click "Don’t allow". The step is marked declined.', run: () => send('Run the command ls -la right now with run_command. Do not ask me first; the app will ask me.') },
    { t: 'Researcher on the web', say: 'It searches, then asks before opening github.com: click "Allow once".', run: async () => { await openChat('Demo · Researcher'); await send('What is the newest release of Ollama on GitHub? Search, then open the most relevant page.'); } },
    { t: 'Attaching a file', say: 'Attaches notes.txt and asks about it. The answer: $12,400 and March 3.', run: async () => {
      await openChat('Demo · Attachment');
      await js(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(notes)}], 'notes.txt', { type: 'text/plain' })); document.querySelector('.view-host .composer').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
      await sleep(800);
      await send('What was the approved budget and the new launch date?');
    } },
    { s: '6. The orchestrator', t: 'A plan in a chat', say: 'The orchestrator proposes a plan: the Researcher finds the forecast and the Writer drafts the email. You can edit it before it runs.', run: async () => {
      await openChat('Demo · Orchestrator');
      await send('Find out what the weather will be in San Juan, Puerto Rico this weekend, then write a short, friendly email to my team suggesting an outdoor activity that fits the forecast.');
    } },
    { t: 'Run the plan', say: 'When it asks to open a weather site, click "Allow all sites for this run". Then the tasks run in order (1–1.5 minutes).', run: async () => { await runPlan(); await waitDone(); } },
    { t: 'The Orchestrator page', say: 'A new run from its own page. It should create a new agent: a Social Media Specialist.', run: async () => {
      await view('Orchestrator');
      await js(`document.querySelector('button[title="New run"]').click()`);
      await sleep(500);
      await type(`${page} textarea`, 'Write a short product description for a reusable steel water bottle called "Tide". Then have a social media specialist agent write three catchy posts (one each for Instagram, X, and LinkedIn) based on that description.');
      await sleep(300);
      await clickText('Make a plan');
      await waitFor(`[...document.querySelectorAll('button')].some(b => b.offsetParent && b.innerText.trim().startsWith('Run plan'))`);
    } },
    { t: 'Run it and watch the board', say: 'One column per agent, with live task cards. The new agent has a "new" badge (about 45 seconds).', run: async () => {
      await runPlan();
      await sleep(2000);
      await waitFor(`![...document.querySelectorAll('button')].some(b => b.offsetParent && b.innerText.trim() === 'Stop')`, 600);
    } },
    { t: 'The new agent is saved', run: () => view('Agents & Skills') },
    { s: '7. Scheduler', t: 'Scheduled tasks', say: 'Tasks run prompts, agents, orchestrator goals, or commands at set times. "Morning haiku" runs every day at 8:00.', run: async () => {
      await view('Scheduler');
      await js(`[...document.querySelectorAll('${page} .conv-item')].find(e => e.innerText.includes('Morning haiku'))?.click()`);
    } },
    { t: 'Run now', say: 'Runs the task right away. Its result goes to its own chat, and the run log at the bottom records it.', run: async () => {
      await clickText('Run now');
      await sleep(1500);
      await waitFor(`!document.querySelector('.run-entry.running') && !!document.querySelector('.run-entry')`, 300);
      await js(`document.querySelector('.run-row')?.click(); document.querySelector('.run-log')?.scrollIntoView({ block: 'center', behavior: 'smooth' })`);
    } },
    { s: '8. Keeps running in the background', t: 'A longer story', say: 'Sends a story and switches tabs: the dot on the Chat icon means it’s still writing.', run: async () => { await openChat('Demo · Story'); await send('Write a 200-word short story about a lighthouse keeper.', { wait: false }); await sleep(2500); await view('My Models'); } },
    { t: 'Back to the chat', say: 'The story is complete.', run: async () => { await sleep(1000); await openChat('Demo · Story'); await waitDone(); } },
    { t: 'That’s the tour', say: 'Everything ran on this computer. Close this window to end the demo; its chats and files are deleted.' },
  ];

  // ---- the panel ----
  await js(`(() => {
    document.title = 'Penumbra · Demo';
    const p = document.createElement('div');
    p.id = 'demo-panel';
    p.innerHTML = '<div id="dp-sec"></div><div id="dp-title"></div><div id="dp-say"></div><div id="dp-err"></div><div id="dp-row"><span id="dp-count"></span><span><button id="dp-skip">Skip</button> <button id="dp-next">Next ▶</button></span></div>';
    const css = document.createElement('style');
    css.textContent = '#demo-panel{position:fixed;left:72px;bottom:12px;z-index:5000;width:280px;background:#211d33;border:1px solid #6c5ce7;border-radius:12px;padding:12px 14px;font:13px/1.4 -apple-system,system-ui,sans-serif;color:#e8e6f3;box-shadow:0 12px 36px rgba(0,0,0,.5)}#dp-sec{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#a597ff}#dp-title{font-weight:600;font-size:14px;margin:2px 0 4px}#dp-say{color:#bdb9cf}#dp-err{color:#ffb3b3;margin-top:6px}#dp-err:empty{display:none}#dp-row{display:flex;align-items:center;justify-content:space-between;margin-top:10px}#dp-count{color:#8c88a3;font-size:12px}#dp-next{background:#6c5ce7;border:none;color:#fff;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer}#dp-next:disabled{opacity:.55;cursor:default}#dp-skip{background:none;border:1px solid #4a4466;color:#bdb9cf;border-radius:8px;padding:6px 10px;cursor:pointer}';
    document.head.append(css);
    document.body.append(p);
    window.__demo = { next: false, skip: false };
    p.querySelector('#dp-next').onclick = () => { window.__demo.next = true; };
    p.querySelector('#dp-skip').onclick = () => { window.__demo.skip = true; };
  })()`);
  // The panel shows the step about to run; Next runs it, then the following step appears.
  const show = (i, phase, err = '') => {
    const st = STEPS[i];
    const sec = STEPS.slice(0, i + 1).reverse().find((x) => x.s)?.s || 'Penumbra';
    const label = phase === 'running' ? 'Working…' : err ? 'Retry' : i === STEPS.length - 1 ? 'Done' : 'Next ▶';
    return js(`(() => { const $ = (id) => document.getElementById(id);
      $('dp-sec').textContent = ${JSON.stringify(sec)}; $('dp-title').textContent = ${JSON.stringify(st.t)};
      $('dp-say').textContent = ${JSON.stringify(st.say || '')}; $('dp-err').textContent = ${JSON.stringify(err)};
      $('dp-count').textContent = 'Step ${i + 1} of ${STEPS.length}';
      $('dp-skip').style.display = ${JSON.stringify(err ? '' : 'none')};
      $('dp-next').textContent = ${JSON.stringify(label)}; $('dp-next').disabled = ${phase === 'running' || i === STEPS.length - 1};
      window.__demo.next = false; window.__demo.skip = false; })()`);
  };
  const click = async () => {
    for (;;) {
      const d = await js('window.__demo');
      if (d?.next) return 'next';
      if (d?.skip) return 'skip';
      await sleep(250);
    }
  };

  let i = 0;
  let err = '';
  for (;;) {
    await show(i, 'idle', err);
    if (i === STEPS.length - 1) break;
    const action = await click();
    if (action === 'next' && STEPS[i].run) {
      await show(i, 'running');
      try {
        await STEPS[i].run();
      } catch (e) {
        if (!alive()) return;
        err = e.message;
        continue;
      }
    }
    err = '';
    i++;
  }
}

function registerDemo({ createWindow, protectSession }) {
  ipcMain.handle('demo:start', (e, model) => {
    if (e.senderFrame !== e.sender.mainFrame || typeof model !== 'string' || !model.trim()) throw new Error('Not allowed');
    if (demo && !demo.isDestroyed()) {
      demo.show();
      demo.focus();
      return 'focused';
    }
    // A fresh, in-memory storage area: the demo starts clean every time and leaves nothing behind.
    const partition = `penumbra-demo-${Date.now()}`;
    const { session } = require('electron');
    protectSession(session.fromPartition(partition));
    const win = createWindow({ partition });
    demo = win;
    win.on('closed', () => {
      if (demo === win) demo = null;
      fs.rmSync(path.join(app.getPath('userData'), 'demo'), { recursive: true, force: true });
    });
    runDemo(win, model.trim()).catch((err) => {
      if (!win.isDestroyed()) console.warn('Demo stopped:', err);
    });
    return 'started';
  });
}

module.exports = { registerDemo };
