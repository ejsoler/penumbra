// Builds the HTML document an interactive widget runs in. Widgets are written by a model, so they
// are untrusted: they run in an iframe with sandbox="allow-scripts" (opaque origin, so no access to
// the app, its storage, or Ollama) under a CSP that allows only the sites it was granted (see
// network.ts). Bundled libraries are inlined, so widgets that use them work offline.

/** The widget's CSP: inline code plus https access to `hosts` ('all' = any https site, [] = offline). */
export function widgetCsp(hosts: string[] | 'all' = []): string {
  const net = hosts === 'all' ? ' https:' : hosts.map((h) => ` https://${h}`).join('');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval'${net}`,
    `style-src 'unsafe-inline'${net}`,
    `img-src data: blob:${net}`,
    `font-src data:${net}`,
    `media-src data: blob:${net}`,
    `connect-src${net || " 'none'"}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

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
  // Errors a widget catches and logs still count, so the user can ask the model to fix them.
  const consoleError = console.error.bind(console);
  console.error = (...args) => {
    consoleError(...args);
    report(args.map((a) => (a && a.message) || String(a)).join(' '));
  };
  // A request to a site the widget wasn't granted: let the app offer to allow it.
  addEventListener('securitypolicyviolation', (e) => {
    if (/^https?:/.test(e.blockedURI)) post({ type: 'blocked', url: e.blockedURI.slice(0, 500) });
  });
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
  // Place name to coordinates via OpenStreetMap. Models write over-specific searches ("El Morro, Old
  // San Juan, Puerto Rico") that find nothing, so retry with fewer parts. Nominatim allows 1 request/s.
  let geoQueue = Promise.resolve();
  const geoCache = new Map();
  const lookup = async (q) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
        if (r.ok) return r.json();
        if (attempt >= 2) throw new Error('Place lookup failed (HTTP ' + r.status + ')');
      } catch (e) {
        if (attempt >= 2) throw new Error('Place lookup is busy or unreachable; try Reload in a minute');
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  };
  const nominatim = (q) => {
    const run = geoQueue.then(() => lookup(q));
    geoQueue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
    return run;
  };
  const geocode = async (query) => {
    const parts = String(query).replace(/[(][^)]*[)]/g, ' ').split(',').map((s) => s.split(' ').filter(Boolean).join(' ')).filter(Boolean).slice(0, 6);
    if (!parts.length) throw new Error('geocode: empty place name');
    // Names like "El Morro fort" fail where "El Morro" works, so also try without generic words.
    const generic = ['fort', 'fortress', 'castle', 'museum', 'park', 'palace', 'church', 'cathedral', 'building', 'monument', 'the'];
    const bare = parts[0].split(' ').filter((w) => !generic.includes(w.toLowerCase())).join(' ') || parts[0];
    const names = [...new Set([parts[0], bare])];
    const contexts = [parts.slice(1), parts.length > 2 ? [parts[parts.length - 1]] : null, []].filter(Boolean);
    const tries = [];
    for (const ctx of contexts) for (const n of names) tries.push([n, ...ctx].join(', '));
    // Then shorten the name word by word ("La Fortaleza Presidential Palace" → "La Fortaleza"), keeping the country.
    const words = bare.split(' ');
    const where = parts.length > 1 ? [parts[parts.length - 1]] : [];
    for (let k = words.length - 1; k >= 2; k--) tries.push([words.slice(0, k).join(' '), ...where].join(', '));
    for (const q of [...new Set(tries)]) {
      if (!geoCache.has(q)) geoCache.set(q, nominatim(q));
      const d = await geoCache.get(q);
      if (d && d.length) return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon), name: d[0].display_name };
    }
    throw new Error('Place not found: ' + query);
  };
  window.penumbra = { ask: (text) => post({ type: 'followup', text: String(text).slice(0, 4000) }), geocode };
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
canvas { max-height: 480px; } /* stops Chart.js resize loops when a chart has no fixed-height container */
`;

/** Chart.js defaults that match the theme, so model-written charts look right without styling. */
const CHART_DEFAULTS = `if (window.Chart) {
  Chart.defaults.color = '#9a9ca5';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
  Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font');
  Chart.defaults.plugins.legend.labels.color = '#e6e7ea';
}`;

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

/** Saved widgets open in a browser on their own, so they get a title and a solid page background. */
const STANDALONE_CSS = `html { background: var(--bg); } body { max-width: 960px; margin: 24px auto; }`;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function buildWidgetDocument(code: string, { standalone = false, hosts = [] as string[] | 'all' } = {}): Promise<string> {
  const used = usedLibraries(code);
  const libs = await Promise.all(used.map(loadLib));
  if (used.includes('chart')) libs.push(CHART_DEFAULTS);
  const { head, body } = sanitize(code);
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${widgetCsp(hosts)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${standalone ? `<title>${escapeHtml(widgetTitle(code))}</title>` : ''}
<style>${BASE_CSS}${standalone ? STANDALONE_CSS : ''}</style>
<script>${BRIDGE}</script>
${libs.map((src) => `<script>${escapeScript(src)}</script>`).join('\n')}
${head}
</head><body>
${body}
</body></html>`;
}
