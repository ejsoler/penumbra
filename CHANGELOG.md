# Changelog

## Unreleased

### Added
- **Home.** Penumbra now opens on a Home dashboard: ask something to start a chat right away, and see every tab at a glance (recent chats, agents to chat with, upcoming scheduled tasks, orchestrator runs, loaded models and downloads, recent images, your last backup, and whether an update is out), each with a link to jump in. The tutorial starts with it.
- **Long chats keep going.** Chats no longer lose their beginning when they outgrow the model's context:
  - Older messages are sent in a shorter form: widget code, attached files, and images in earlier messages are replaced by short notes (the chat on screen doesn't change; the last few messages always go whole).
  - When a chat still wouldn't fit, the model first summarizes the older part ("Summarizing earlier messages to make room…"), and from then on gets the summary instead of those messages. A line in the chat marks where the summary ends; click it to read the summary, or stop using it.
  - **Compact now** (in the settings panel, and in a notice above the message box when the context is over 80% full) summarizes on demand.
  - The context meter warns when it's nearly full and offers **Raise to…**, a bigger context up to the model's own maximum.
- **Continue a cut-off reply.** When a reply stops at the **Max Tokens** limit, it says so and offers **Continue**, which picks it up exactly where it stopped.

## 0.4.0 (2026-11-02)

### Added
- **Adjust an agent's image.** **Adjust image** under an agent's card (or **Adjust…** in its avatar menu) opens a preview of the card: drag the picture to choose what shows, and zoom with the slider or the scroll wheel. The round avatar uses the same framing. New image avatars are saved at 512px, so they stay sharp when zoomed.
- **Backup tab.** Save chats (with their attachments and widgets), agents, skills, images, scheduled tasks (with their run logs), and settings in one .zip file: everything, or the items you pick from each list. **Only those in the chosen chats** picks just the images your chosen chats show. **Restore** opens a backup, shows what's in it, and adds what you choose to the current profile: items already here are skipped, changed ones are added as copies, chats keep their agents and images, and restored scheduled tasks start paused. Settings are only replaced if you choose them. Models and profile passwords aren't included.
- **Back up one chat.** A button at the top of each chat (and **Back up this chat…** in a chat's right-click menu) saves that chat in a backup file with what it needs: its agent, the agent's skills, and the images it shows. Restore it from the Backup tab.
- **Internet access per chat.** Each chat's settings panel has its own Internet access: **Approved sites, ask for others** or **Whole internet** (with a warning first), and sites only that chat may use. New chats start with the default from **Options**, and every chat checks the sites in Options first, then its own. A widget asking for a site offers **Always in this chat** next to **Always in all chats**.

### Changed
- **Tutorial and guided demo.** The tutorial shows backing up a chat, adjusting an agent's picture, and Updates. The guided demo shows a chat's own internet access, adjusting the Writer's picture, the Images and Backup tabs, and backing up one chat; it now also keeps its own images folder, so it never sees yours.

## 0.3.1 (2026-11-02)

### Changed
- **Updates tab.** The arrow icon in the sidebar now opens an Updates tab instead of a small card. It shows the full release notes with their screenshots, the download with its progress, and Skip this version, without cutting off the buttons. **Options → Updates** links to it.

## 0.3.0 (2026-10-31)

### Added
- **Images tab (local image generation).** Make images on your computer, outside Ollama:
  - Search Hugging Face for GGUF image models, see each repo's files and sizes, and download one. Penumbra reads each file's type first: Z-Image and FLUX.1 are supported; others show as not supported yet.
  - Images are made by [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp), downloaded from its GitHub releases the first time (Apple Silicon Macs, and x64 Windows and Linux). Each model family's shared files (VAE and text encoders) are downloaded once.
  - Downloads resume if interrupted and are checked against the hashes Hugging Face and GitHub publish.
  - Models marked "not for all audiences" are hidden unless you choose to show them, labeled 18+, and ask before downloading.
  - Choose size, steps, and seed; recent images are kept with their settings.
  - **Generate…** in the avatar menu (agents and your profile) makes an avatar with your image model.
  - **Images in chats and agents:** a new **Images** tool. Ask for a picture in any chat and the model creates it with your image model; it appears in the reply, with its size, seed, and a button to show the file. It's on for chats once an image model is installed, and agents get it with the **Images** checkbox. Orchestrator tasks can use it too.
  - **Where images are saved:** in **Pictures/Penumbra** by default, with readable names (date, time, and the start of the prompt). **Change…** in the Images tab picks another folder, and **Reset** goes back. In a chat with a folder, images are saved in that folder. Chats keep only a short reference to each image, and only images Penumbra made can be shown. Deleting one from the gallery moves it to the Trash.
- **Image lightbox.** Click any image (in a reply, one you attached, or in the Images tab) to see it full-window. Zoom with the wheel or a pinch toward the pointer, drag to move around, double-click to zoom in or fit, and use the arrow keys to step through a set. The prompt shows underneath, scrolls when it's long, and has a button to copy it. **Show in folder** opens the file, and Esc closes.
- **Profiles.** Keep separate chats, agents, skills, settings, scheduled tasks, and image history for different people or uses (Work, Personal…). Create and switch profiles from the button at the bottom of the sidebar; downloaded models are shared. Your existing data becomes the first profile.
  - **Passwords:** a profile can have a password. Penumbra shows a lock screen until it's entered, and nothing in the profile starts before that. **Lock now** locks it right away. Passwords are stored only as a salted scrypt hash, and wrong guesses slow down after five. It's an app lock: it doesn't encrypt the files on disk (FileVault or BitLocker does).
  - Deleting a profile (its password is needed) removes its chats, settings, and skills; images it saved in folders stay.
  - **Move a chat to another profile:** right-click it → **Move to profile…**. A profile with a password asks for it. The chat's agents come along if the other profile doesn't have them, and its generated images still show there.
  - **Default profile:** ★ in the profile list picks the profile Penumbra opens at startup. The default profile can't be deleted until another one is the default.
- **Tutorial.** A guided tour of every tab opens when Penumbra starts: chat (chats, agent picker, model, interactive answers, message box, settings), the orchestrator, the scheduler, agents and skills, images, My Models and Discover, your profile, and Options. Each step switches to its tab, highlights the feature, and explains it. It shows at every start until you click **Don't show again**; that choice is per profile, so each new profile sees it once. **Options → Tutorial** opens it again and turns the startup display back on.
- **Your own approved sites:** add your own sites to the approved list in **Options → Internet access** (one list for all chats; each chat's settings panel shows a summary and a link to it) (`api.example.com`, `*.example.com` for every subdomain, or paste a link), and remove them there. Widgets and agents' web tools use them without asking. Local addresses and IPs can't be added.

### Changed
- The **Developer** tab is now **Options** (with a gear icon): server, tutorial, internet access, guided demo, updates, and API examples.
- Internet access is set once for all chats in **Options → Internet access**; each chat's settings panel shows a summary with a link there.

## 0.2.0 (2026-10-30)

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
- **Personas.** **New agent** opens a short wizard: a **Purpose**, an **Agent name**, and a **Persona** (a sentence or two on personality, communication style, and approach, with a few ideas to start from). Every agent keeps the model's full knowledge and abilities; the persona shapes how it talks, reasons, and works, for the whole conversation. Templates come with personas, the orchestrator gives new agents one, and **Instructions** are now optional extra rules.
- **Agent avatars.** Give an agent an image (upload or drop one; it's cropped to a square and kept small) or an emoji, in the wizard or on its page. Agents without one show colored initials. Avatars appear in the agent list, the chat's agent picker, and next to the agent's replies.
- **Agent trading cards.** The Agents tab shows each agent as a trading card in its own color: name and model size, the avatar as card art, its purpose, its tools as abilities, and its persona as flavor text. Cards tilt and shine under the pointer. **Edit** and **Chat** sit under each card; **All agents** (or **← All agents**) brings you back.
- **Your profile.** The new button at the bottom of the sidebar sets your name and avatar (an image or an emoji). They appear on your messages instead of "You". Both stay on your computer and aren't sent to the models.
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
  - A **run log** on each task: every run with its start time, what triggered it (on schedule, Run now, or missed while Penumbra was quit), how long it took, the result or error, the tools it used, and any wait for your OK. It keeps the last 50 runs per task, and you can clear it.
  - A notification when a task finishes or needs you. Tasks run one at a time and wait while you're using the chat. A run missed while Penumbra was quit runs once when it opens.
- **Guided demo.** **Developer → Guided demo → Start demo** opens the tour from `docs/DEMO.md` in its own window, with demo chats, agents, skills, and files, so yours aren't touched. A panel shows each step, and nothing happens until you click Next. Closing the window deletes the demo's files.
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
