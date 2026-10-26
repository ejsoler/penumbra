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

### Changed
- Chats with interactive answers on use a context of at least 16K tokens, since widget replies are long.

### Security
- Widgets run in a sandboxed iframe with an opaque origin and a strict Content Security Policy: no network, no access to the app, its storage, or Ollama.
- The app blocks navigation, network requests, and permission requests from any embedded frame.
- A widget whose height keeps growing (a layout loop) is frozen instead of growing forever.

## 0.1.0 (2026-10-20)

First release.

- Chat with streaming Markdown, code highlighting, reasoning ("thought process"), image attachments, edit & resend, regenerate, branch, and per-chat system prompts.
- Model picker, My Models (load, eject, delete, inspect), and sampling controls.
- Downloads from the Ollama library and Hugging Face (GGUF), with pause, resume, and retry.
- Right-click menus and keyboard shortcuts.
- Installers for macOS (DMG), Windows (NSIS), and Linux (AppImage, deb).
