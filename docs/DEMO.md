# Penumbra 0.2.0 demo script

A walkthrough of everything new in 0.2.0: interactive answers, internet widgets, agents, skills, tools, and the orchestrator. It takes about 25 minutes. Each section says what to click, what to type, and what to say. Times are from test runs on a Mac with `qwen3.8:27b-mlx`; a different model or computer will be faster or slower.

Lines in *italics* are things to say. Prompts in code blocks are meant to be pasted as-is: they've all been tested, except where a section says otherwise.

## Before the demo

Do this 10 minutes before you start.

1. **Ollama is running** and the demo model is downloaded:
   ```bash
   ollama pull qwen3.8:27b-mlx
   ```
   Use a local model for the whole demo. Cloud models (names ending in `-cloud`) send chats to Ollama's servers.
2. **Load the model** so the first answer isn't slow: open Penumbra, press <kbd>⌘L</kbd>, pick `qwen3.8:27b-mlx`.
3. **Turn reasoning off** for snappier answers: settings panel (right) → Generation → uncheck **Reasoning / Thinking**.
4. **Import the demo skill:** Agents & Skills tab (robot icon) → **Skills** → **Import…** → choose `docs/demo/skills/company-memo`.
5. **Copy the demo folder** somewhere you can show, for example `~/Desktop/penumbra-demo`:
   ```bash
   cp -R docs/demo/workspace ~/Desktop/penumbra-demo
   ```
6. **Start from a clean slate:** a new chat (<kbd>⌘N</kbd>). If you've used the app before, the first-use notice for interactive answers won't appear; that's fine, skip that step in section 1.
7. Close other heavy apps. Running a 27B model and recording the screen at the same time is a lot for one computer.

## 1. Interactive answers (3 min)

*"Penumbra runs AI models on your own computer. In 0.2.0, the model can answer with small live apps instead of only text."*

1. Point at the **Interactive** switch at the top left of the chat. *"It's on by default, for each chat."*
2. Send:
   ```
   Make me a simple tool to convert temperatures between Celsius and Fahrenheit, with a slider.
   ```
3. The first time, a notice explains interactive answers. Click **Keep it on**. *"It tells you once that these apps run in a sandbox: they can't see your chats or files."*
4. While it writes, point at **Building interactive answer… N lines**. It takes about 30 seconds.
5. Drag the slider. *"That's code the model just wrote, running live."*
6. Show the toolbar: **View code**, **Save as HTML** (opens in any browser), and **full screen** (Esc closes it).
7. Contrast with a plain question:
   ```
   What is the capital of Japan?
   ```
   *"The model decides: for a simple fact, it just answers in text."*

## 2. Fixing and follow-ups (2 min)

1. Send:
   ```
   Show me how the phases of the moon work, with a slider and a play button.
   ```
   About a minute. *"Explanations become something you can play with."*
2. **Ask model to fix:** when a widget shows a red error bar, click **Ask model to fix**. The model gets the error and writes a corrected version. *(You can't count on an error appearing during a demo. If you want to show this for sure, see "Optional: a guaranteed error" at the end.)*
3. **Follow-ups:** some widgets have buttons with suggested questions. Clicking one puts the question in your message box. *"It never sends anything by itself; you decide."*

## 3. Widgets with internet (4 min)

*"Widgets can also use the internet, for maps and live data, with clear limits."*

1. Send:
   ```
   Show me a map of the earthquakes of magnitude 4.5 or more in the past week.
   ```
   About 35 seconds. A dark world map with real USGS data and a magnitude slider.
2. Click the **🌐 number** in the widget's toolbar to open its **network log**. *"Every request a widget makes is listed. Widgets can only download: uploads, cookies, and your local network are blocked."*
3. Send:
   ```
   Show me a map of Old San Juan, Puerto Rico with markers for El Morro, Castillo San Cristóbal, and La Fortaleza.
   ```
   *"Models misremember coordinates, so widgets look places up on OpenStreetMap."* Markers appear a few seconds after the map, one lookup per second.
4. Send:
   ```
   What's the weather forecast for the next 5 days in Madrid? Show it as a chart.
   ```
5. **Asking before other sites:** maps, weather, and similar public data are on an approved list. Any other site shows **Allow / Always allow / Run offline** before the widget runs. *(Not tested as a demo prompt; this one should trigger it:)*
   ```
   Show the current price of Bitcoin in USD from the CoinGecko API.
   ```
6. Open the settings panel → **Internet access**. Show **See list**, and that choosing **Whole internet** shows a warning first. Leave it on **Approved sites**.

## 4. Agents and skills (4 min)

*"Agents are models with their own job: instructions, skills, and tools."*

1. Open the **Agents & Skills** tab (robot icon). Click the **Writer** template, and set its model to `qwen3.8:27b-mlx`.
2. Switch to **Skills** and open **company-memo**. *"A skill is a folder with instructions, the same format Claude uses. The model only reads it when a task matches."* Show its reference file `templates/memo.md`.
3. Back in **Agents**, click **Chat with agent**. Turn **Interactive** off for this chat, then send:
   ```
   Write a memo telling the team the office is closed this Friday for maintenance.
   ```
   About 10 seconds. Point at the steps: **Load skill**, then **Read skill file**, then a memo that starts with `MEMO //` and ends with `— Penumbra Corp · Internal`. *"It found the skill on its own and followed the company format exactly."*
4. **Create a skill live:** Skills → **New**, paste:
   ```
   ---
   name: haiku-mode
   description: Use when the user asks for a poem.
   ---
   Always answer with a single haiku (5-7-5 syllables), nothing else.
   ```
   Click **Create skill**. In a new chat with no agent, send `Write me a short poem about the sea.` It loads **haiku-mode** and answers with a haiku.

## 5. Tools: files, terminal, web, attachments (5 min)

*"Agents can also work with files, the terminal, and the web, and they ask before anything risky."*

1. Agents & Skills → template **Coder** → model `qwen3.8:27b-mlx` → **Chat with agent**.
2. In the settings panel, under **Tools** → **Folder**, choose `~/Desktop/penumbra-demo`.
3. Send:
   ```
   Read data.csv, then write a Python script summary.py that prints the average of the score column, and run it with python3.
   ```
   You'll see **List files**, **Read file**, **Write file**, then a **Run this command?** bar with `python3 summary.py`. *"Nothing runs without my OK."* Click **Run**. The answer is **84.5**.
4. Show a refusal:
   ```
   Run the command ls -la right now with run_command. Do not ask me first; the app will ask me.
   ```
   Click **Don't allow**. The step is marked **declined**, and the agent continues another way.
5. **Web:** template **Researcher** → model → **Chat with agent**:
   ```
   What is the newest release of Ollama on GitHub? Search, then open the most relevant page.
   ```
   About 25 seconds. It searches, then asks before opening github.com. Click **Allow once**.
6. **Attachments:** in a plain chat, drag `docs/demo/notes.txt` into the message box and send:
   ```
   What was the approved budget and the new launch date?
   ```
   Answer: $12,400 and March 3.

## 6. The orchestrator (6 min)

*"Now several agents working together. The orchestrator plans, assigns, and puts it all together."*

### In a chat

1. New chat → agent picker → **Orchestrator**. Keep `qwen3.8:27b-mlx` as the model. Turn **Interactive** off.
2. Send:
   ```
   Find out what the weather will be in San Juan, Puerto Rico this weekend, then write a short, friendly email to my team suggesting an outdoor activity that fits the forecast.
   ```
3. In about 15 seconds the plan appears: **Researcher** gets the forecast, then **Writer** drafts the email using it. *"I can change anything here: tasks, agents, models, instructions."*
4. Click **Run plan**. When it asks to open a weather site, click **Allow all sites for this run**: *"one OK for the whole plan, web only. Commands always ask one by one."*
5. Watch the tasks run in order, then the final answer. About 1–1.5 minutes.

### On the Orchestrator page

1. Open the **Orchestrator** tab (the icon below Chat). Show that the run you just did is in the list.
2. Click **+**, check that the **planner model** is `qwen3.8:27b-mlx`, and enter:
   ```
   Write a short product description for a reusable steel water bottle called "Tide". Then have a social media specialist agent write three catchy posts (one each for Instagram, X, and LinkedIn) based on that description.
   ```
3. **Make a plan**. It creates a new **Social Media Specialist** agent. *"It makes agents when it needs a role I don't have."*
4. **Run plan**. The board shows one column per agent, with live task cards; the new agent has a **new** badge. About 45 seconds.
5. Open the **Agents & Skills** tab: the Social Media Specialist is saved there and can be reused.

## 7. Keeps running in the background (1 min)

1. In any chat, send a longer request, for example `Write a 200-word short story about a lighthouse keeper.`
2. While it writes, switch to another tab. *"The dot on the chat icon means it's still working."*
3. Come back: the story is complete.

## Closing (1 min)

*"Everything ran on this computer. Widgets and agents reach the internet only for what they're doing, ask before other sites, and can't touch my local network. Commands and file changes stay in a folder I choose, and every command needs my OK."*

## If something goes wrong

- **A reply is slow:** the first reply after switching models loads that model into memory. Keep one model for the whole demo.
- **The model writes text instead of a widget:** say "Make it interactive", or use **Regenerate**.
- **A widget errors:** click **Ask model to fix**. That's a feature worth showing.
- **The orchestrator's plan is odd:** edit it before clicking **Run plan**, or **Cancel** and rephrase.
- **Too many "Open a website?" prompts:** click **Allow all sites for this run**.
- **Numbers look wrong:** models can make mistakes, including in widgets. Say so; it's honest, and the network log and steps show where answers came from.

## Optional: a guaranteed error

To show **Ask model to fix** on demand, ask for a widget with a deliberate bug:

```
Make a tip calculator widget, and in its script call a helper function named formatMoney without defining it.
```

The widget shows `formatMoney is not defined`. Click **Ask model to fix**; the corrected version calculates correctly (18% of $80 = $14.40). *(This exact prompt hasn't been tested; the fix itself was tested with a widget containing this same bug.)*
