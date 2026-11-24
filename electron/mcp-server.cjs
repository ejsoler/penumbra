// Penumbra as an MCP server: other apps (Claude Desktop, Cursor, scripts…) connect to it over HTTP on this
// computer, with a secret token, and use the tools the user turned on in Connections. This side speaks the
// protocol and asks the user to confirm; the window does the work, because the chats, projects, and models
// live there (src/mcpServer.ts). Listens only on 127.0.0.1.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 1024 * 1024;
const plain = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

/** Every tool, by what it needs the user to have allowed. `does` finishes the sentence in the confirmation. */
const TOOLS = [
  { cap: 'ask', name: 'list_models', description: 'Lists the models installed in Ollama on this computer.', schema: obj({}), readOnly: true, does: 'list your installed models' },
  { cap: 'ask', name: 'list_agents', description: "Lists Penumbra's agents: name, purpose, and model.", schema: obj({}), readOnly: true, does: 'list your agents' },
  {
    cap: 'ask',
    name: 'ask',
    description: 'Sends a message to a local model or agent and returns its answer. Good for heavy work: the model reads and processes the material itself, and only the answer comes back. The conversation is saved as a chat in Penumbra (titled “MCP · …”). Give chat_id to continue an earlier chat (it remembers what it read), or project_id to start it inside a project. For a new chat, folder and tools let the model read files in a folder or fetch web pages (read only).',
    schema: obj({
      prompt: str('The message'),
      model: str('A model name (default: the one the user chats with most, if it can chat)'),
      agent: str('An agent’s name'),
      chat_id: str('Continue this chat'),
      project_id: str('Start the chat in this project'),
      folder: str('A full path to a folder on this computer the model may read from (new chats; needs tools: ["files"])'),
      tools: { type: 'array', items: { type: 'string', enum: ['files', 'web'] }, description: 'Read-only tools for a new chat: "files" (read the folder) and "web" (search and fetch pages)' },
    }, ['prompt']),
    does: 'ask a local model',
  },
  { cap: 'read', name: 'list_chats', description: 'Lists chats, newest first: id, title, model, project, and size.', schema: obj({ query: str('Only chats whose title contains this'), project_id: str('Only chats of this project'), limit: num('Default 30') }), readOnly: true, does: 'list your chats' },
  { cap: 'read', name: 'read_chat', description: 'Reads the messages of a chat.', schema: obj({ chat_id: str('The chat'), offset: num('First message, from 0'), limit: num('How many messages (default 40)') }, ['chat_id']), readOnly: true, does: 'read one of your chats' },
  { cap: 'read', name: 'search_chats', description: 'Searches the words of all chats and returns the best matches.', schema: obj({ query: str('Words to look for'), limit: num('Default 10') }, ['query']), readOnly: true, does: 'search your chats' },
  { cap: 'read', name: 'list_projects', description: 'Lists projects: id, name, and how many chats and sources each has.', schema: obj({}), readOnly: true, does: 'list your projects' },
  { cap: 'read', name: 'read_project', description: "Reads a project: its instructions, folder, source files and notes, and its chats.", schema: obj({ project_id: str('The project') }, ['project_id']), readOnly: true, does: 'read one of your projects' },
  { cap: 'read', name: 'read_memory', description: 'Reads the notes Penumbra keeps: about the user, a project, or a chat.', schema: obj({ scope: { type: 'string', enum: ['user', 'project', 'chat'] }, id: str('The project or chat (not needed for the user)') }, ['scope']), readOnly: true, does: 'read your memory notes' },
  { cap: 'projects', name: 'create_project', description: 'Creates a project.', schema: obj({ name: str('Name'), instructions: str('Instructions every chat in it follows'), folder: str('A folder on this computer for its file tools') }, ['name']), does: 'create a project' },
  { cap: 'projects', name: 'update_project', description: 'Changes the name or instructions of a project.', schema: obj({ project_id: str('The project'), name: str('New name'), instructions: str('New instructions') }, ['project_id']), does: 'change a project' },
  { cap: 'projects', name: 'add_project_source', description: 'Adds a text file or note to a project’s sources, so its chats know it.', schema: obj({ project_id: str('The project'), name: str('A name, like notes.txt'), text: str('The text') }, ['project_id', 'name', 'text']), does: 'add a source to a project' },
  { cap: 'projects', name: 'move_chat', description: 'Moves a chat into a project, or out of its project when project_id is left out.', schema: obj({ chat_id: str('The chat'), project_id: str('The project (leave out to take it out of its project)') }, ['chat_id']), does: 'move a chat between projects' },
  { cap: 'images', name: 'generate_image', description: 'Makes a picture with the image model installed in Penumbra and returns it. It is also saved in Penumbra’s images.', schema: obj({ prompt: str('A detailed description of the picture, in English'), width: num('Pixels (default 1024)'), height: num('Pixels (default 1024)') }, ['prompt']), does: 'make an image' },
  { cap: 'images', name: 'run_orchestrator', description: 'Gives a goal to the orchestrator, which plans tasks for Penumbra’s agents, runs them, and returns the final answer. It is saved as a chat. Can take several minutes.', schema: obj({ goal: str('What to achieve'), model: str('The planner model (default: the first installed that supports tools)'), folder: str('A folder for file and terminal tools') }, ['goal']), does: 'run the orchestrator' },
];

let server = null;
let cfg = null;
let owner = null; // the window that does the work
let error = '';
const sessions = new Map();
const calls = new Map();
let queue = Promise.resolve();

const publicTool = (t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.schema,
  annotations: { readOnlyHint: !!t.readOnly, destructiveHint: false, openWorldHint: false },
});

function windowOf() {
  return owner && !owner.isDestroyed() ? BrowserWindow.fromWebContents(owner) : null;
}

/** Asks the user, in a dialog, whether this app may do this. Resolves 'once', 'always', or false. Asks one at a time. */
function confirm(client, tool, args) {
  const run = async () => {
    const win = windowOf();
    if (!win) return false;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    let detail = '';
    try {
      detail = JSON.stringify(args ?? {}, null, 2);
    } catch {
      /* not printable */
    }
    const r = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Penumbra',
      message: `“${client || 'An app'}” wants to ${tool.does}.`,
      detail: `${tool.description}\n\n${detail.length > 900 ? `${detail.slice(0, 900)}…` : detail}`.trim(),
      buttons: ['Allow once', `Always allow “${tool.name}”`, "Don't allow"],
      defaultId: 2,
      cancelId: 2,
      noLink: true,
    });
    return r.response === 0 ? 'once' : r.response === 1 ? 'always' : false;
  };
  // Dialogs queue up instead of stacking.
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

/** Runs a tool in the window and waits for its answer. */
function forward(session, tool, args, onGone) {
  return new Promise((resolve, reject) => {
    if (!owner || owner.isDestroyed()) return reject(new Error("Penumbra's window is closed."));
    const id = crypto.randomUUID();
    const timeout = Math.max(10, Math.min(Number(cfg.timeoutSec) || 900, 3600)) * 1000;
    const timer = setTimeout(() => {
      calls.delete(id);
      owner?.send('mcpserver:cancel', id);
      reject(new Error(`Penumbra didn't finish in ${Math.round(timeout / 60000)} minutes.`));
    }, timeout);
    calls.set(id, { resolve, reject, timer });
    onGone?.(() => {
      if (calls.delete(id)) {
        clearTimeout(timer);
        owner?.send('mcpserver:cancel', id);
        reject(new Error('The app stopped waiting.'));
      }
    });
    owner.send('mcpserver:call', id, { tool: tool.name, args, client: session.client });
  });
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const toolError = (id, text) => rpcResult(id, { content: [{ type: 'text', text }], isError: true });

async function handleMessage(msg, session, onGone) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid request');
  const { id, method, params } = msg;
  if (id === undefined) return null; // a notification
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS.filter((t) => cfg.caps[t.cap]).map(publicTool) });
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return rpcError(id, -32602, `Unknown tool "${params?.name}"`);
    if (!cfg.caps[tool.cap]) return toolError(id, 'The user has not allowed this kind of tool in Penumbra (Connections → Penumbra as a server).');
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    if (cfg.confirm[tool.cap] && !cfg.allowed.includes(tool.name)) {
      const answer = await confirm(session.client, tool, args);
      if (!answer) return toolError(id, "The user didn't allow this. Don't try again unless they ask.");
      if (answer === 'always') {
        cfg.allowed = [...new Set([...cfg.allowed, tool.name])];
        if (owner && !owner.isDestroyed()) owner.send('mcpserver:allowed', tool.name);
      }
    }
    try {
      const r = await forward(session, tool, args, onGone);
      const content = [];
      if (r.text) content.push({ type: 'text', text: String(r.text) });
      for (const img of r.images || []) content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
      if (!content.length) content.push({ type: 'text', text: '(no output)' });
      return rpcResult(id, { content, isError: !!r.isError });
    } catch (e) {
      return toolError(id, plain(e));
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function startServer(config, sender) {
  stopServer();
  error = '';
  cfg = normalize(config);
  owner = sender;
  sender.once('destroyed', stopServer);
  const port = cfg.port;
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  server = http.createServer(async (req, res) => {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    // Only this computer, and never a web page: a browser sends an Origin, apps don't.
    if (!new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}$`).test(req.headers.host || '') || req.headers.origin) return send(403, { error: 'Forbidden' });
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || '';
    if (!cfg.token || !same(bearer, cfg.token)) return send(401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    if (new URL(req.url, 'http://x').pathname !== '/mcp') return send(404, { error: 'Not found. The endpoint is /mcp' });
    if (req.method === 'DELETE') {
      sessions.delete(req.headers['mcp-session-id']);
      return send(200);
    }
    if (req.method !== 'POST') return send(405, { error: 'Use POST' }, { Allow: 'POST, DELETE' });

    let body = '';
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return send(413, { error: 'Too large' });
      body += chunk;
    }
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      return send(400, rpcError(null, -32700, 'Parse error'));
    }
    const list = Array.isArray(msg) ? msg : [msg];

    // A new session starts with initialize.
    const init = list.find((m) => m && m.method === 'initialize');
    let sid = req.headers['mcp-session-id'];
    if (init) {
      sid = crypto.randomUUID();
      sessions.set(sid, { client: String(init.params?.clientInfo?.name || '').slice(0, 60) || 'An app', at: Date.now() });
      const wanted = init.params?.protocolVersion;
      return send(200, rpcResult(init.id, {
        protocolVersion: SUPPORTED.includes(wanted) ? wanted : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'Penumbra', version: app.getVersion() },
        instructions: 'Penumbra is a desktop app for local models (Ollama). The tools here use the models, chats, and projects on the user’s computer. The user decides which tools exist and can be asked before each use.',
      }), { 'Mcp-Session-Id': sid });
    }
    if (sid && !sessions.has(sid)) return send(404, rpcError(null, -32001, 'Session not found: start again with initialize'));
    const session = sessions.get(sid) ?? { client: 'An app' };

    // A call that may run long streams keep-alives, so clients that wait on an open stream don't give up.
    const long = list.some((m) => m && m.method === 'tools/call') && /text\/event-stream/.test(req.headers.accept || '');
    let gone = () => {};
    let alive = true;
    res.on('close', () => {
      alive = false;
      gone();
    });
    const onGone = (cancel) => {
      gone = cancel;
    };
    let ping;
    if (long) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      ping = setInterval(() => alive && res.write(': keep-alive\n\n'), 10000);
    }
    const replies = (await Promise.all(list.map((m) => handleMessage(m, session, onGone)))).filter(Boolean);
    clearInterval(ping);
    if (!alive) return;
    const out = Array.isArray(msg) ? replies : replies[0];
    if (long) {
      if (out) res.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
      return res.end();
    }
    if (!out || (Array.isArray(out) && !out.length)) return send(202);
    return send(200, out);
  });

  server.on('error', (e) => {
    error = e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Pick another port.` : e.message;
    server = null;
  });
  server.listen(port, '127.0.0.1');
}

function stopServer() {
  if (server) {
    server.close();
    server.closeAllConnections?.();
  }
  server = null;
  sessions.clear();
  for (const [id, c] of calls) {
    clearTimeout(c.timer);
    c.reject(new Error('Penumbra stopped the server.'));
    calls.delete(id);
  }
}

function normalize(c) {
  const caps = c && c.caps && typeof c.caps === 'object' ? c.caps : {};
  const confirmCfg = c && c.confirm && typeof c.confirm === 'object' ? c.confirm : {};
  return {
    port: Math.max(1024, Math.min(65535, Math.round(Number(c && c.port)) || 8765)),
    token: typeof (c && c.token) === 'string' ? c.token : '',
    caps: { ask: !!caps.ask, read: !!caps.read, projects: !!caps.projects, images: !!caps.images },
    // Asks first unless the user turned that off for this kind of tool.
    confirm: { ask: confirmCfg.ask !== false, read: confirmCfg.read === true, projects: confirmCfg.projects !== false, images: confirmCfg.images !== false },
    allowed: Array.isArray(c && c.allowed) ? c.allowed.map(String) : [],
    timeoutSec: Number(c && c.timeoutSec) || 900,
  };
}

/** The bridge for apps that only start programs (stdio): copied where it can be run from, outside the app bundle. */
function bridgePath() {
  const dest = path.join(app.getPath('userData'), 'penumbra-mcp-bridge.cjs');
  try {
    const src = fs.readFileSync(path.join(__dirname, 'mcp-bridge.cjs'));
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(src)) fs.writeFileSync(dest, src);
  } catch {
    /* the app still works without the bridge */
  }
  return dest;
}

function registerMcpServer() {
  ipcMain.handle('mcpserver:start', (e, config) => {
    startServer(config, e.sender);
    return new Promise((resolve) => setTimeout(() => resolve({ running: !!server && server.listening, error, port: cfg.port }), 250));
  });
  ipcMain.handle('mcpserver:update', (_e, config) => {
    if (!server) return;
    const next = normalize(config);
    // Tools turned off or a new token take effect for the next request; a new port needs a restart.
    cfg = { ...next, port: cfg.port };
  });
  ipcMain.handle('mcpserver:stop', () => {
    stopServer();
    error = '';
  });
  ipcMain.handle('mcpserver:status', () => ({ running: !!server && server.listening, error, port: cfg ? cfg.port : 0, clients: [...new Set([...sessions.values()].map((s) => s.client))], bridge: bridgePath(), exe: process.execPath }));
  ipcMain.on('mcpserver:reply', (_e, id, result) => {
    const c = calls.get(id);
    if (!c) return;
    calls.delete(id);
    clearTimeout(c.timer);
    c.resolve(result || {});
  });
  ipcMain.handle('mcpserver:focus', () => {
    const w = windowOf();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });
  app.on('before-quit', stopServer);
}

module.exports = { registerMcpServer, TOOLS };
