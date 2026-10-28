<p align="center">
  <img src="build/icon.png" width="128" alt="Penumbra icon" />
</p>

<h1 align="center">Penumbra</h1>

<p align="center">
  A desktop app for <a href="https://ollama.com">Ollama</a>. Chat with local models, manage them, and download new ones from the Ollama library or Hugging Face, with a layout inspired by LM Studio.
</p>

<p align="center">
  <a href="https://ko-fi.com/O8O227N74P"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi" /></a>
</p>

---

## Features

**Chat**
- Streaming responses with Markdown, tables, and syntax-highlighted code blocks
- Collapsible "thought process" for reasoning models (Qwen3, DeepSeek-R1, gpt-oss, …)
- Tokens/sec, token count, and time-to-first-token for every reply
- Edit & resend, regenerate, branch a chat from any message, delete messages
- Image attachments for vision models (drag & drop or paste)
- Per-chat system prompt; chats are saved locally

**Interactive answers** *(new in 0.2.0)*
- The model can reply with small live apps right in the chat: calculators, charts, step-through diagrams, 3D views, quizzes
- It decides on its own when an app helps more than text, and answers in plain text otherwise
- Turn it on or off for each chat with the **Interactive** switch at the top (on by default)
- Chart.js, D3, and Three.js are built in, so widgets work offline
- Widgets can use the internet for maps and live public data (weather, earthquakes, exchange rates, Wikipedia). Approved sites work right away; any other site asks you first. A **Whole internet** option is in the settings panel
- Open a widget full screen, save it as a standalone `.html` file, or view and copy its code
- Widgets can suggest follow-up questions; they go into your message box, and you decide whether to send them
- If a widget breaks, **Ask model to fix** sends the error back to the model for a corrected version
- Works best with 7B+ models. Interactive chats use at least a 16K context

**Agents, skills & orchestration** *(new in 0.2.0)*
- Create agents with their own model, instructions, skills, and tools, and pick one in any chat
- Skills use Claude's `SKILL.md` format: create them in the app or import folders and `.zip` files. The model loads a skill only when a task needs it
- Tools: web search and pages, read and write files in a folder you choose, and terminal commands (each one asks you first). Every reply shows the tools it used
- Attach text files to a message
- The **Orchestrator** plans a goal into tasks, creates the agents it needs, lets you review and edit the plan, then runs each task on its agent and writes the final answer. Follow runs on a board with one column per agent
- The **Scheduler** runs prompts, agents, orchestrator goals, or terminal commands at set times or on repeat, with a chat per task for the results. While tasks are on, Penumbra keeps running in the menu bar when you close the window

**Models**
- Model picker (<kbd>⌘L</kbd>) that loads the model into memory, with capability badges (vision, tools, reasoning)
- *My Models*: see what's loaded and how much VRAM it uses, load/eject/delete, and inspect architecture, template, and modelfile
- Sampling controls: temperature, top-k, top-p, min-p, repeat penalty, context length, max tokens, seed, keep-alive

**Downloads**
- Pull anything from the [Ollama library](https://ollama.com/library)
- Search **Hugging Face** for GGUF models and pick a quantization. It's pulled as `hf.co/<repo>:<quant>`
- Pause, resume, and retry downloads, with speed and time remaining; unfinished downloads survive restarts

**Everywhere**
- Right-click menus for chats, messages, code blocks, models, and downloads
- Keyboard shortcuts: <kbd>⌘N</kbd> new chat, <kbd>⌘L</kbd> model picker, <kbd>Enter</kbd> send, <kbd>Shift</kbd>+<kbd>Enter</kbd> newline

## Requirements

- [Ollama](https://ollama.com/download) installed and running (`ollama serve`)
- [Node.js](https://nodejs.org) 22 or newer
- macOS, Windows, or Linux

## Download

Get the latest installer from [Releases](https://github.com/ejsoler/penumbra/releases):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon / Intel) | `Penumbra-<version>-mac-arm64.dmg` / `-mac-x64.dmg` |
| Windows | `Penumbra-Setup-<version>-x64.exe` (or `-arm64.exe`) |
| Linux | `Penumbra-<version>-linux-x86_64.AppImage`, or `.deb` for Debian/Ubuntu |

The builds aren't code-signed yet, so your OS will warn you the first time:

- **macOS:** right-click the app → **Open** → **Open**. On recent macOS versions: System Settings → Privacy & Security → **Open Anyway**.
- **Windows:** on the SmartScreen prompt, click **More info** → **Run anyway**.
- **Linux (AppImage):** `chmod +x Penumbra-*.AppImage` and run it.

## Build from source

```bash
git clone https://github.com/ejsoler/penumbra.git
cd penumbra
npm install
npm run app
```

### Install as a Mac app

```bash
npm run install-app
```

This builds `Penumbra.app`, signs it for local use, and copies it to `/Applications`. Run it again after you pull updates.

### All scripts

| Command | What it does |
| --- | --- |
| `npm run app` | Desktop app with hot reload (Electron + Vite) |
| `npm run dev` | Browser-only version at http://localhost:5173 |
| `npm run build` | Type-check and build the web assets to `dist/` |
| `npm start` | Build, then run in Electron without hot reload |
| `npm run dist` | Package installers for the current OS into `release/` |
| `npm run dist:mac` / `dist:win` / `dist:linux` | Package for a specific OS |
| `npm run install-app` | macOS: package and copy `Penumbra.app` to `/Applications` |
| `npm run icons` | Regenerate icons from `build/icon.svg` |

## Configuration

By default the app talks to Ollama at `http://127.0.0.1:11434`. You can change this in **Developer → Server URL**, for example to use Ollama on another machine. That server must allow the app's origin:

```bash
OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=* ollama serve
```

## Project structure

```
electron/         Electron main process, preload bridge, skills, tools (files, terminal, web), update check, menu bar
src/
  updates.ts      Update check state (the sidebar icon and Developer panel)
  scheduler.ts    Scheduled tasks: timing, running them, menu bar status
  api.ts          Ollama REST client (streaming chat, pull, show, ps…)
  hf.ts           Hugging Face Hub search + GGUF quant listing
  downloads.ts    Download queue with pause/resume
  store.ts        Persistent state and Ollama polling
  session.ts      Shared chat state (conversations, running reply, pending approvals)
  agents/         Agent loop, tools, skills, agents store, orchestrator planning
  components/     Model picker, Markdown renderer, widget frame, plan card, context menu, icons
  widgets/        Widget sandbox document, system prompt, bundled chart/3D libraries
  views/          Chat, Orchestrator, Scheduler, Agents & Skills, My Models, Discover, Hugging Face, Developer
build/            App icon source, icon generator, install script
```

## Privacy

Everything runs locally. The app itself talks only to your Ollama server, plus the Hugging Face API when you browse the Hugging Face tab, and GitHub's release list to check for updates (turn that off in the Developer tab). Widgets and agents reach the internet only for what they're doing (a map, a weather forecast, a web search or page), under the rules below. Chats and settings are stored in the app's local storage on your machine.

If you use a cloud model from Ollama (names ending in `-cloud`), Ollama sends that chat to its servers. The orchestrator never picks a cloud model for new agents on its own.

Interactive widgets are code written by the model, so Penumbra treats them as untrusted. Each one runs in a sandboxed frame with no network access and no access to your chats, files, or Ollama. It can only resize itself, report errors, and suggest a follow-up question that you choose whether to send.

Widgets can download from a list of approved sites (map tiles, script CDNs, and keyless public data). Any other site needs your OK for that widget, unless you turn on **Whole internet** in the settings panel. In every mode, widgets can only make https GET requests: they can't upload or post data, send cookies, or reach your computer, local network, or Ollama. Each widget's network log shows every request it made.

Scheduled tasks run unattended, so they only skip the usual questions for what you allow in each task (opening websites, running commands); everything else waits for you. A command task runs its command without asking each time, since you wrote it.

Agents follow the same internet rules. Their file tools only work inside the folder you choose for a chat, replaced files go to the Trash, and every terminal command waits for your approval. Approved commands run with your user account's permissions, so read them before you allow them. Skills are stored in Penumbra's data folder (open it from the Skills tab).

## Support

If Penumbra is useful to you, you can support its development on Ko-fi:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/O8O227N74P)

## License

[MIT](LICENSE)

Interactive answers bundle [Chart.js](https://www.chartjs.org) (MIT), [D3](https://d3js.org) (ISC), and [Three.js](https://threejs.org) (MIT).

*Penumbra is an independent project. It is not affiliated with or endorsed by Ollama or LM Studio.*
