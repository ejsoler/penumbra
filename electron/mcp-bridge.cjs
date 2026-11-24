// Lets an app that only starts programs (stdio) use Penumbra's MCP server, which listens on a local address.
// Reads JSON-RPC lines on stdin, sends each to Penumbra over HTTP, and writes the answers to stdout.
//   PENUMBRA_MCP_URL    default http://127.0.0.1:8765/mcp
//   PENUMBRA_MCP_TOKEN  the token shown in Penumbra (Connections → Penumbra as a server)
const readline = require('readline');

const url = process.env.PENUMBRA_MCP_URL || 'http://127.0.0.1:8765/mcp';
const token = process.env.PENUMBRA_MCP_TOKEN || '';
let session = '';

const write = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const fail = (id, message) => id !== undefined && id !== null && write({ jsonrpc: '2.0', id, error: { code: -32000, message } });

async function forward(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: line,
    });
    session = res.headers.get('mcp-session-id') || session;
    if (res.status === 202 || res.status === 204) return;
    if (res.status === 401) return fail(msg.id, 'Penumbra refused the token. Copy it again from Connections → Penumbra as a server.');
    if (!res.ok) return fail(msg.id, `Penumbra answered ${res.status}`);
    const text = await res.text();
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) process.stdout.write(`${data}\n`);
      }
    } else if (text.trim()) {
      const v = JSON.parse(text);
      for (const m of Array.isArray(v) ? v : [v]) write(m);
    }
  } catch (e) {
    fail(msg.id, `Can't reach Penumbra at ${url}. Is it open, with the server turned on? (${e.cause?.code || e.message})`);
  }
}

const pending = new Set();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const p = forward(line).finally(() => pending.delete(p));
  pending.add(p);
}).on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
