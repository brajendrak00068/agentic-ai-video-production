// Autonomous mode is opt-in since 0.8.0: without LEVEA_ENABLE_AUTONOMOUS the
// server lists only the direct tools, describes only them, and answers a call
// of a hidden tool with the flag that turns it on. Runs against the built
// package: `npm run build && npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { TOOLS, AUTONOMOUS_TOOL_NAMES, listedTools, autonomousEnabled } from '../dist/server.js';

const HIDDEN = ['autonomous_edit', 'autonomous_edit_streaming', 'queue_edit', 'get_active_task'];

/** initialize + tools/list (+ one optional tools/call) against the stdio server; returns the three results. */
async function session(env, call) {
  let posts = 0;
  const backend = http.createServer((req, res) => {
    if (req.method === 'POST') posts++;
    req.resume();
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ success: true, status: 'completed' })); });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const child = spawn(process.execPath, [new URL('../dist/index.js', import.meta.url).pathname], {
    env: { ...process.env, LEVEA_API_URL: `http://127.0.0.1:${backend.address().port}`, LEVEA_API_KEY: 'test-key-123456', LEVEA_TELEMETRY: 'off', ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const want = call ? 3 : 2;
  const results = {};
  try {
    await new Promise((resolve, reject) => {
      let buf = '';
      const guard = setTimeout(() => reject(new Error('server did not answer')), 15_000);
      child.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n').slice(0, -1)) {
          try { const m = JSON.parse(line); if (m.id) results[m.id] = m.result ?? m.error; } catch { /* partial */ }
        }
        buf = buf.split('\n').pop();
        if (Object.keys(results).length >= want) { clearTimeout(guard); resolve(); }
      });
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      if (call) send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: call });
    });
  } finally {
    child.kill();
    backend.close();
  }
  return { init: results[1], list: results[2], call: results[3], posts };
}

test('the flag reads 1 or true; anything else is off', () => {
  assert.deepEqual([...AUTONOMOUS_TOOL_NAMES].sort(), [...HIDDEN].sort());
  for (const v of ['1', 'true', 'TRUE', ' 1 ']) assert.equal(autonomousEnabled({ LEVEA_ENABLE_AUTONOMOUS: v }), true, v);
  for (const v of [undefined, '', '0', 'false', 'yes']) assert.equal(autonomousEnabled({ LEVEA_ENABLE_AUTONOMOUS: v }), false, String(v));
});

test('by default tools/list has none of the autonomous tools; with the flag it is the full list as before', async () => {
  const off = await session({ LEVEA_ENABLE_AUTONOMOUS: '' });
  const offNames = off.list.tools.map((t) => t.name);
  for (const h of HIDDEN) assert.ok(!offNames.includes(h), `${h} is listed without the flag`);
  assert.deepEqual(offNames, TOOLS.map((t) => t.name).filter((n) => !HIDDEN.includes(n)));

  const on = await session({ LEVEA_ENABLE_AUTONOMOUS: '1' });
  assert.deepEqual(on.list.tools, JSON.parse(JSON.stringify(TOOLS)));
});

test('without the flag, no listed tool names a hidden one anywhere in its description or schema', () => {
  for (const t of listedTools(false)) {
    const text = JSON.stringify(t);
    for (const h of HIDDEN) assert.ok(!text.includes(h), `${t.name} still names ${h}`);
  }
});

test('calling a hidden tool without the flag is a tool error naming the flag, and nothing reaches the backend', async () => {
  const r = await session({ LEVEA_ENABLE_AUTONOMOUS: '' }, { name: 'autonomous_edit', arguments: { prompt: 'x', video_url: 'https://example.com/a.mp4' } });
  assert.equal(r.call.isError, true);
  const text = r.call.content.map((c) => c.text).join('\n');
  assert.ok(text.includes('autonomous_edit is off by default'), text);
  assert.ok(text.includes('LEVEA_ENABLE_AUTONOMOUS=1'), text);
  assert.ok(!text.includes('Unknown tool'), text);
  assert.equal(r.posts, 0);
});

test('the initialize instructions match the flag state', async () => {
  const off = (await session({ LEVEA_ENABLE_AUTONOMOUS: '' })).init.instructions;
  for (const h of HIDDEN) assert.ok(!off.includes(h), `instructions name ${h} without the flag`);
  assert.ok(off.includes('execute_batch'));
  const on = (await session({ LEVEA_ENABLE_AUTONOMOUS: '1' })).init.instructions;
  assert.ok(on.startsWith('Levea is a cloud video editor with two modes:'), on);
  assert.ok(on.includes('get_active_task { project_id }'));
});

test('manifest.json lists exactly the default tools, with the server\'s own descriptions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.tools, listedTools(false).map((t) => ({ name: t.name, description: t.description })));
});
