// Builds the HTML document an interactive widget runs in. Widgets are written by a model, so they
// are untrusted: they run in an iframe with sandbox="allow-scripts" (opaque origin, so no access to
// the app, its storage, or Ollama) under a CSP that blocks all network access. Libraries are inlined.

/** No network of any kind; only inline code, styles, and data: images. */
export const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

type Lib = 'chart' | 'd3' | 'three';

const LIB_USAGE: Record<Lib, RegExp> = {
  chart: /\bnew\s+Chart\b|\bChart\./,
  d3: /\bd3\./,
  three: /\bTHREE\./,
};

const LIB_LOADERS: Record<Lib, () => Promise<{ default: string }>> = {
  chart: () => import('./vendor/chart.js?raw'),
  d3: () => import('./vendor/d3.js?raw'),
  three: () => import('./vendor/three.js?raw'),
};

const libCache = new Map<Lib, Promise<string>>();
const loadLib = (lib: Lib) => {
  if (!libCache.has(lib)) libCache.set(lib, LIB_LOADERS[lib]().then((m) => m.default));
  return libCache.get(lib)!;
};

export const usedLibraries = (code: string) => (Object.keys(LIB_USAGE) as Lib[]).filter((l) => LIB_USAGE[l].test(code));

/** Runs first inside the widget: reports size and errors, and offers window.penumbra.ask(). */
const BRIDGE = `(() => {
  const post = (m) => parent.postMessage(Object.assign({ __penumbra: 1 }, m), '*');
  const report = (msg) => post({ type: 'error', message: String(msg).slice(0, 2000) });
  addEventListener('error', (e) => report(e.message || 'Error'));
  addEventListener('unhandledrejection', (e) => report((e.reason && e.reason.message) || e.reason));
  const size = () => {
    const b = document.body;
    if (!b) return;
    const cs = getComputedStyle(b);
    post({ type: 'resize', height: Math.ceil(b.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)) });
  };
  // The frame is out-of-process and may get its real size only after load, so measure again then.
  addEventListener('DOMContentLoaded', () => { new ResizeObserver(size).observe(document.body); size(); });
  addEventListener('resize', size);
  addEventListener('load', () => { size(); [100, 500, 1500].forEach((t) => setTimeout(size, t)); post({ type: 'ready' }); });
  window.penumbra = { ask: (text) => post({ type: 'followup', text: String(text).slice(0, 4000) }) };
})();`;

/** Matches the app's dark theme so widgets feel native. */
const BASE_CSS = `
:root {
  --bg: #16171a; --surface: #1b1c20; --elev: #222328; --border: #2c2e34; --border-strong: #3a3d45;
  --text: #e6e7ea; --muted: #9a9ca5; --faint: #6c6f78;
  --accent: #8b7cf6; --accent-strong: #a597ff; --green: #3ecf8e; --red: #f26d6d; --amber: #f0b44c;
  --font: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
  --mono: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { background: transparent; }
body { margin: 0; padding: 14px; color: var(--text); font: 14px/1.5 var(--font); background: transparent; overflow-x: auto; }
h1, h2, h3, h4 { margin: 0 0 .6em; line-height: 1.3; }
p { margin: 0 0 .8em; }
button { font: inherit; color: #fff; background: var(--accent); border: 1px solid var(--accent); border-radius: 8px; padding: 6px 14px; cursor: pointer; }
button:hover { background: var(--accent-strong); }
button.secondary { background: var(--elev); border-color: var(--border-strong); color: var(--text); }
input, select, textarea { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border-strong); border-radius: 7px; padding: 6px 9px; outline: none; }
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
input[type=range], input[type=checkbox], input[type=radio] { accent-color: var(--accent); padding: 0; }
label { color: var(--muted); font-size: 13px; }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--border-strong); padding: 6px 10px; text-align: left; }
th { background: var(--elev); }
code { font-family: var(--mono); font-size: .9em; }
canvas, svg { max-width: 100%; }
`;

const escapeScript = (code: string) => code.replace(/<\/script/gi, '<\\/script');

export function widgetTitle(code: string): string {
  const comment = /<!--\s*title:\s*([^>]{1,80}?)\s*-->/i.exec(code)?.[1];
  const tag = /<title>([^<]{1,80})<\/title>/i.exec(code)?.[1];
  return (comment || tag || 'Interactive answer').trim();
}

/** Keeps a model-written fragment or full document, minus anything that could navigate the frame. */
function sanitize(code: string): { head: string; body: string } {
  const doc = new DOMParser().parseFromString(code, 'text/html'); // inert: nothing executes here
  doc.querySelectorAll('meta[http-equiv], base, title').forEach((el) => el.remove());
  return { head: doc.head.innerHTML, body: doc.body.innerHTML };
}

export async function buildWidgetDocument(code: string): Promise<string> {
  const libs = await Promise.all(usedLibraries(code).map(loadLib));
  const { head, body } = sanitize(code);
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${BASE_CSS}</style>
<script>${BRIDGE}</script>
${libs.map((src) => `<script>${escapeScript(src)}</script>`).join('\n')}
${head}
</head><body>
${body}
</body></html>`;
}
