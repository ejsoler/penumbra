// A tiny MCP server (over stdio) for the guided demo: two tools about a made-up project. Penumbra starts it
// with its own program in Node mode (ELECTRON_RUN_AS_NODE), so the demo needs nothing installed.
const readline = require('readline');

const tools = [
  { name: 'launch_status', description: 'Returns the current status of Project Tide: progress, next milestone, and the owner.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'open_tasks', description: 'Lists the open tasks of Project Tide.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
];
const answers = {
  launch_status: 'Project Tide is on track: 12 of 15 tasks are done. The next milestone is the beta on March 3. The owner is Marisol Vega.',
  open_tasks: '1. Write the launch announcement (Marisol Vega)\n2. Test the installer on Windows (Diego Ruiz)\n3. Record the demo video (Ana Torres)',
};
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Project Tide tracker', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools } });
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: answers[m.params.name] || 'Unknown tool.' }], isError: !answers[m.params.name] } });
  else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Not supported' } });
});
