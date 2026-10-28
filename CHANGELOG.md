# Changelog

## 0.2.0 (unreleased)

### Added
- **Interactive answers.** The model can reply with small live apps (calculators, charts, diagrams, 3D views, quizzes) that run inside the chat. It decides on its own when an app helps more than text.
- **Interactive** switch at the top of each chat to turn it on or off. It is on by default, and a short notice explains it the first time.
- Chart.js 4, D3 7, and Three.js are built in, so widgets work offline.
- Widget toolbar: full screen, save as a standalone `.html` file, view code, copy code, reload.
- Follow-up questions: a widget can offer questions that go into your message box. Nothing is sent until you send it.
- **Ask model to fix:** when a widget shows an error, one click sends the error to the model and asks for a corrected widget.
- A "best with 7B+" hint when a small model is selected with interactive answers on.
- **Internet for widgets:** maps (Leaflet with OpenStreetMap or Esri tiles), live public data (weather, earthquakes, exchange rates, Wikipedia, countries), and libraries from CDNs.
  - A built-in list of approved sites works right away. Any other site shows an Allow / Always allow / Run offline card on that widget first.
  - Optional **Whole internet** mode in the settings panel, with a warning before it turns on.
  - Every widget has a network log listing each request it made, including blocked ones.
  - If a widget tries a site it wasn't granted, a bar offers to allow it.
  - Errors a widget catches and logs with `console.error` also show the **Ask model to fix** button.
  - Built-in `penumbra.geocode()` helper, so maps place landmarks from OpenStreetMap instead of the model's memory, which is often hundreds of meters off.
- **Agents.** A new **Agents & Skills** tab to create agents: a name, a model, instructions, and the skills and tools each one may use. Start from a template (Researcher, Writer, Coder, Analyst) or a blank agent, and pick an agent in any chat.
- **Skills** in the same format Claude uses: a folder with a `SKILL.md` and optional reference files. Create and edit them in the app, import folders or `.zip` files, and turn each one on or off. The model only sees each skill's name and description, and loads the full skill when a task matches it.
- **Tools** for agents and chats, using Ollama's tool calling:
  - **Web:** search (DuckDuckGo, no key) and read pages.
  - **Read files** and **Write files** in a folder you choose for the chat. A replaced file goes to the Trash first.
  - **Terminal:** run commands in that folder. Every command asks you first.
  - Each reply shows the tools it used, in place, with what they returned.
- **Attach text files** to a message (notes, CSVs, code); the model gets their contents.
- **Orchestrator.** Pick it in a chat, or open the new **Orchestrator** tab, and give it a goal:
  - It proposes a plan: which existing agents to use, which new agents to create (with model, tools, and instructions), and the tasks, with dependencies.
  - You review and edit the plan, then run it. Tasks run one at a time on their agents, each getting the results it depends on, and the orchestrator writes the final answer.
  - The Orchestrator tab lists every run and shows a board with one column per agent and live task cards.
  - Agents it creates are saved to the Agents tab.
- **Scheduler.** A new **Scheduler** tab for timed tasks:
  - A task can be a prompt for a model or agent, an orchestrator goal (planned and run without review, since nobody is there to approve it), or a terminal command in a folder.
  - Run it once at a set time, daily or on chosen weekdays at a set time, or every N minutes or hours. **Run now** runs it right away.
  - Each task has its own chat (⏰ in the chat list) that collects every run's result. Runs don't build on each other: each one starts from the task's prompt.
  - **Without asking:** choose what a task may do on its own (open websites, run terminal commands). Anything else waits for your OK, with a notification.
  - While any task is on, closing the window keeps Penumbra in the menu bar (system tray on Windows and Linux) so tasks run on time. Quit from the menu bar icon. You can turn this off.
  - A notification when a task finishes or needs you. Tasks run one at a time and wait while you're using the chat. A run missed while Penumbra was quit runs once when it opens.
- **Update check.** Penumbra asks GitHub for the latest release shortly after it opens and twice a day. A newer version shows as a small arrow icon at the bottom of the sidebar, with no pop-ups. Clicking it shows what's new and downloads the installer for your computer to the Downloads folder, checking it against the release's checksum. You can also skip that version. The **Developer** tab has **Check now** and a switch to turn the check off.

### Changed
- Chats with interactive answers or tools use a context of at least 16K tokens, since widget replies and tool results are long.
- Replies keep streaming when you switch to another tab.
- Single line breaks in replies are kept, so addresses, lists, and memos read as written.
- The internet setting in the chat panel is now **Internet access** and covers both widgets and agents' web tools.

### Security
- Widgets run in a sandboxed iframe with an opaque origin and a strict Content Security Policy that allows only the sites granted to that widget. They have no access to the app, its storage, or Ollama.
- The app blocks navigation and permission requests from any embedded frame.
- In every mode, widget requests are limited to https GET: no uploads or posts, no cookies, no WebSockets, no addresses over 2,048 characters, and nothing on this computer, the local network, or the Ollama server (checked again after DNS lookup).
- Widgets identify themselves to websites only as Penumbra, never with anything from your chat.
- A widget whose height keeps growing (a layout loop) is frozen instead of growing forever.
- Agent web tools follow the same rules: sites outside the approved list ask first (once, always, or for the rest of a run), and nothing on this computer, the local network, or the Ollama server can be reached, even through redirects.
- File tools can't leave the chat's folder (symlinks included), and the folder can't be the whole disk or your home folder.
- Terminal commands always need your approval, one by one. They run with your user account's permissions, so read each one before you allow it.
- The orchestrator never assigns a cloud model to a new agent on its own when it plans with a local model.

## 0.1.0 (2026-10-20)

First release.

- Chat with streaming Markdown, code highlighting, reasoning ("thought process"), image attachments, edit & resend, regenerate, branch, and per-chat system prompts.
- Model picker, My Models (load, eject, delete, inspect), and sampling controls.
- Downloads from the Ollama library and Hugging Face (GGUF), with pause, resume, and retry.
- Right-click menus and keyboard shortcuts.
- Installers for macOS (DMG), Windows (NSIS), and Linux (AppImage, deb).
