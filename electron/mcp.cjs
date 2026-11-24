// A small MCP client (Model Context Protocol): connects to servers the user added, over stdio (a program
// Penumbra starts) or Streamable HTTP (a URL), lists their tools, and calls them. Only tools are supported.
// The window decides what to connect to and asks the user before a tool runs (src/mcp.ts); this side just
// speaks the protocol and owns the child processes. Connections belong to the window that made them and
// end when it closes or the app quits.
const { app, ipcMain } = require('electron');
const { spawn } = require('child_process');
const os = require('os');

const PROTOCOL = '2025-06-18';
const MAX_LINE = 8 * 1024 * 1024;
const MAX_RESULT = 60 * 1024;
const CONNECT_TIMEOUT = 45000;
const CALL_TIMEOUT = 120000;

const plain = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---- the user's PATH ---------------------------------------------------------------------------------
// An app opened from the Dock doesn't get the shell's PATH, so `npx` or `uvx` wouldn't be found.
let pathPromise = null;
function loginPath() {
  if (process.platform === 'win32') return Promise.resolve(process.env.PATH || '');
  pathPromise ??= new Promise((resolve) => {
    const fallback = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', `${os.homedir()}/.local/bin`].filter(Boolean).join(':');
    let out = '';
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      const sh = spawn(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'] });
      sh.stdout.on('data', (d) => (out += d));
      sh.on('error', () => finish(fallback));
      sh.on('close', () => {
        const m = /__PATH__(.*)__PATH__/s.exec(out);
        finish(m && m[1] ? `${m[1]}:${fallback}` : fallback);
      });
      setTimeout(() => {
        sh.kill();
        finish(fallback);
      }, 5000);
    } catch {
      finish(fallback);
    }
  });
  return pathPromise;
}

// ---- transports --------------------------------------------------------------------------------------
// Each one sends JSON-RPC messages and calls `onMessage` with every message the server sends back.

class StdioTransport {
  constructor(cfg, onMessage, onClose) {
    this.cfg = cfg;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.stderr = '';
    this.closed = false;
  }

  async start() {
    const env = { ...process.env, ...(this.cfg.env || {}) };
    if (!(this.cfg.env && this.cfg.env.PATH)) env.PATH = await loginPath();
    const win = process.platform === 'win32';
    this.child = spawn(this.cfg.command, this.cfg.args || [], {
      env,
      cwd: this.cfg.cwd || os.homedir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: win, // npx and friends are .cmd files on Windows
      windowsHide: true,
    });
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > MAX_LINE) {
        buf = '';
        return;
      }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          this.onMessage(JSON.parse(line));
        } catch {
          /* not a JSON-RPC line (some servers log to stdout); ignore it */
        }
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (d) => (this.stderr = (this.stderr + d).slice(-4000)));
    this.child.stdin.on('error', () => {});
    this.child.on('error', (e) => this.end(e.code === 'ENOENT' ? `Couldn't start "${this.cfg.command}": program not found. Is it installed?` : `Couldn't start "${this.cfg.command}": ${e.message}`));
    this.child.on('close', (code) => this.end(`The server stopped${code === null ? '' : ` (exit code ${code})`}.${this.stderr.trim() ? `\n${this.stderr.trim().split('\n').slice(-6).join('\n')}` : ''}`));
  }

  async send(msg) {
    if (this.closed || !this.child.stdin.writable) throw new Error('The server is not running.');
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  end(reason) {
    if (this.closed) return;
    this.closed = true;
    this.onClose(reason);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.child.stdin.end();
      const child = this.child;
      // Servers should exit when their input ends; make sure they do.
      setTimeout(() => child.kill('SIGTERM'), 400);
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    } catch {
      /* already gone */
    }
  }
}

class HttpTransport {
  constructor(cfg, onMessage, onClose) {
    this.cfg = cfg;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.session = null;
    this.version = null;
    this.closed = false;
    this.controllers = new Set();
  }

  async start() {
    let u;
    try {
      u = new URL(this.cfg.url);
    } catch {
      throw new Error(`"${this.cfg.url}" isn't a valid address.`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The address must start with http:// or https://');
  }

  async send(msg) {
    if (this.closed) throw new Error('The connection is closed.');
    const headers = {
      ...(this.cfg.headers || {}),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    if (this.version) headers['MCP-Protocol-Version'] = this.version;
    const ac = new AbortController();
    this.controllers.add(ac);
    try {
      const res = await fetch(this.cfg.url, { method: 'POST', headers, body: JSON.stringify(msg), signal: ac.signal });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.session = sid;
      if (res.status === 202 || res.status === 204) return;
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(res.status === 401 || res.status === 403 ? `The server refused the connection (${res.status}). Check the key or token in Headers.` : `The server answered ${res.status}${text ? `: ${text}` : ''}`);
      }
      const type = res.headers.get('content-type') || '';
      if (type.includes('text/event-stream')) await this.readEvents(res);
      else if (msg.id !== undefined) this.dispatch(await res.text());
    } catch (e) {
      if (ac.signal.aborted) throw new Error('Cancelled');
      throw e;
    } finally {
      this.controllers.delete(ac);
    }
  }

  dispatch(text) {
    if (!text.trim()) return;
    let v;
    try {
      v = JSON.parse(text);
    } catch {
      return;
    }
    for (const m of Array.isArray(v) ? v : [v]) this.onMessage(m);
  }

  async readEvents(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (buf.length > MAX_LINE) throw new Error('The server sent too much data.');
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const event = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) this.dispatch(data);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const ac of this.controllers) ac.abort();
    if (this.session) fetch(this.cfg.url, { method: 'DELETE', headers: { ...(this.cfg.headers || {}), 'Mcp-Session-Id': this.session } }).catch(() => {});
  }
}

// ---- one connection ----------------------------------------------------------------------------------

class Connection {
  constructor(cfg, onClosed) {
    this.cfg = cfg;
    this.nextId = 1;
    this.pending = new Map();
    this.tools = [];
    this.info = null;
    this.closedReason = null;
    this.onClosed = onClosed;
    const onMessage = (m) => this.handle(m);
    const onClose = (reason) => this.fail(reason);
    this.transport = cfg.transport === 'http' ? new HttpTransport(cfg, onMessage, onClose) : new StdioTransport(cfg, onMessage, onClose);
  }

  handle(m) {
    if (m && m.id !== undefined && m.method === undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error.message || `Error ${m.error.code}`));
      else p.resolve(m.result);
    } else if (m && m.method && m.id !== undefined) {
      // A request from the server: answer pings, refuse the rest (sampling, roots, … aren't supported).
      const reply = m.method === 'ping' ? { jsonrpc: '2.0', id: m.id, result: {} } : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Not supported by Penumbra' } };
      this.transport.send(reply).catch(() => {});
    }
  }

  fail(reason) {
    if (this.closedReason) return;
    this.closedReason = reason || 'Closed';
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(this.closedReason));
    }
    this.pending.clear();
    this.onClosed(this.closedReason);
  }

  request(method, params, timeoutMs = CALL_TIMEOUT) {
    return new Promise((resolve, reject) => {
      if (this.closedReason) return reject(new Error(this.closedReason));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`No answer from the server after ${Math.round(timeoutMs / 1000)} seconds.`));
        this.transport.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } }).catch(() => {});
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({ jsonrpc: '2.0', id, method, params }).catch((e) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  async connect() {
    try {
      await this.transport.start();
      const init = await this.request('initialize', {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'Penumbra', version: app.getVersion() },
      }, CONNECT_TIMEOUT);
      if (this.transport.version !== undefined) this.transport.version = init.protocolVersion || PROTOCOL;
      this.info = { name: init.serverInfo?.name, version: init.serverInfo?.version, instructions: typeof init.instructions === 'string' ? init.instructions.slice(0, 2000) : undefined };
      await this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await this.listTools();
    } catch (e) {
      this.close();
      throw e;
    }
  }

  async listTools() {
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, CONNECT_TIMEOUT);
      for (const t of r.tools || []) {
        if (t && typeof t.name === 'string') {
          tools.push({
            name: t.name,
            title: t.title || t.annotations?.title,
            description: typeof t.description === 'string' ? t.description.slice(0, 2000) : '',
            inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
            readOnly: t.annotations?.readOnlyHint === true,
          });
        }
      }
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    this.tools = tools;
    return tools;
  }

  async call(name, args, timeoutSec) {
    const r = await this.request('tools/call', { name, arguments: args && typeof args === 'object' ? args : {} }, Math.max(5, Math.min(Number(timeoutSec) || 120, 900)) * 1000);
    const parts = [];
    for (const c of r.content || []) {
      if (c.type === 'text') parts.push(String(c.text ?? ''));
      else if (c.type === 'image') parts.push(`[image: ${c.mimeType || 'unknown type'}, not shown]`);
      else if (c.type === 'audio') parts.push(`[audio: ${c.mimeType || 'unknown type'}, not played]`);
      else if (c.type === 'resource' && c.resource) parts.push(typeof c.resource.text === 'string' ? c.resource.text : `[resource ${c.resource.uri || ''}]`);
      else if (c.type === 'resource_link') parts.push(`[link: ${c.uri || c.name || ''}]`);
    }
    if (!parts.length && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent, null, 2));
    let text = parts.join('\n');
    const truncated = text.length > MAX_RESULT;
    if (truncated) text = `${text.slice(0, MAX_RESULT)}\n[Result cut off at ${MAX_RESULT / 1024} KB]`;
    return { text, isError: r.isError === true };
  }

  close() {
    this.fail('Disconnected.');
    this.transport.close();
  }
}

// ---- IPC ---------------------------------------------------------------------------------------------

/** Connections by window and server id. */
const connections = new Map();
const key = (e, id) => `${e.sender.id}:${id}`;

function validate(cfg) {
  if (!cfg || typeof cfg.id !== 'string' || !cfg.id) throw new Error('Missing server id');
  if (cfg.transport === 'http') {
    if (typeof cfg.url !== 'string' || !cfg.url) throw new Error('Enter the server address.');
  } else if (typeof cfg.command !== 'string' || !cfg.command.trim()) {
    throw new Error('Enter the command that starts the server.');
  }
  const clean = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'));
  return {
    id: cfg.id,
    transport: cfg.transport === 'http' ? 'http' : 'stdio',
    command: String(cfg.command || '').trim(),
    args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
    env: clean(cfg.env),
    cwd: typeof cfg.cwd === 'string' && cfg.cwd ? cfg.cwd : undefined,
    url: String(cfg.url || '').trim(),
    headers: clean(cfg.headers),
  };
}

function registerMcp() {
  ipcMain.handle('mcp:connect', async (e, raw) => {
    const cfg = validate(raw);
    const k = key(e, cfg.id);
    connections.get(k)?.close();
    const conn = new Connection(cfg, (reason) => {
      if (connections.get(k) === conn) connections.delete(k);
      if (!e.sender.isDestroyed()) e.sender.send('mcp:closed', cfg.id, reason);
    });
    connections.set(k, conn);
    e.sender.once('destroyed', () => conn.close());
    try {
      await conn.connect();
    } catch (err) {
      connections.delete(k);
      throw new Error(plain(err));
    }
    return { tools: conn.tools, info: conn.info };
  });

  ipcMain.handle('mcp:disconnect', (e, id) => {
    const k = key(e, String(id));
    connections.get(k)?.close();
    connections.delete(k);
  });

  ipcMain.handle('mcp:call', async (e, id, name, args, timeoutSec) => {
    const conn = connections.get(key(e, String(id)));
    if (!conn) throw new Error('This server is not connected.');
    return conn.call(String(name), args, timeoutSec);
  });

  /** What this window is connected to, so a reloaded window doesn't start the servers again. */
  ipcMain.handle('mcp:state', (e) => {
    const out = {};
    for (const [k, c] of connections) if (k.startsWith(`${e.sender.id}:`) && !c.closedReason) out[k.slice(k.indexOf(':') + 1)] = { tools: c.tools, info: c.info };
    return out;
  });

  app.on('before-quit', () => {
    for (const c of connections.values()) c.close();
    connections.clear();
  });
}

module.exports = { registerMcp };
