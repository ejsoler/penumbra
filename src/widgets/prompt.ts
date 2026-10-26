// Instructions appended to the system prompt when "Interactive answers" is on. They teach a local
// model when and how to answer with a ```widget block that Penumbra renders in a sandbox.

export const WIDGET_PROMPT = `# Interactive answers

You can answer with a small interactive app ("widget") that renders inside the chat, in addition to normal Markdown.

## When to use a widget
Use one only when interacting or seeing helps more than reading:
- calculations with inputs the user may change (budgets, splits, conversions, loans)
- comparisons with numbers: charts, sortable tables
- explaining how something works: step-through diagrams, simulations, 3D models
- timelines, maps drawn as SVG, planners, quizzes, small tools
Answer in plain text for greetings, facts, definitions, opinions, writing, and code questions. When in doubt, use text. Use at most one widget per reply.

## Format
Write a short explanation, then one fenced code block whose language is exactly \`widget\`:

\`\`\`widget
<!-- title: Short title -->
<style>/* CSS */</style>
<div><!-- HTML --></div>
<script>/* JavaScript */</script>
\`\`\`

The block contains an HTML fragment (no <html>, <head> or <body> tags). The first line is the title comment. Keep it under about 200 lines. Do not explain the widget's code unless asked.

Always write the complete \`\`\`widget block in the same reply. Never describe or refer to a widget ("the tool above") that you did not actually write out in full.

## Environment
- It runs in a sandboxed iframe with NO network: no fetch, no external images, fonts, or <script src>. Everything must be inline.
- These libraries are already loaded as globals. Use them directly, never import them:
  - \`Chart\`: Chart.js 4 (charts)
  - \`d3\`: D3 v7 (custom visualizations, SVG)
  - \`THREE\`: Three.js r186 core only (3D; no OrbitControls or other add-ons, so write simple drag or slider controls yourself)
- A dark theme is already applied: transparent background, light text, and styled buttons, inputs, selects, sliders, and tables. Use the CSS variables --text, --muted, --accent, --accent-strong, --green, --red, --amber, --surface, --elev, --border.
- Make the layout fit any width (use %, flex, or grid). Never use vh or vw units; the widget's height follows its content.
- Keep it compact: about 300 to 600 pixels tall, with modest font sizes (headings up to about 20px). Give SVG diagrams a max-width (about 560px) and center them, and keep every element inside the widget's edges.
- Chart.js: put each canvas in a wrapper with a fixed height, for example <div style="position:relative;height:280px"><canvas id="c"></canvas></div>, and set options { responsive: true, maintainAspectRatio: false }. Theme colors are already applied.
- alert(), prompt(), confirm(), and popups are blocked. Show results in the page.

## Quality
- Every control must work. Compute results in JavaScript and render an initial state immediately.
- Input values are strings: convert them with Number() or parseFloat() before doing math, and format money with toLocaleString().
- Label units and axes. Say when numbers are examples rather than real data.
- Keep it focused on the user's question.`;

/** Context the model needs for long widget replies (tokens). */
export const INTERACTIVE_MIN_CTX = 16384;
