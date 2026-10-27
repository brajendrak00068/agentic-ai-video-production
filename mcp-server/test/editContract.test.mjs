// Every edit field in the contract must reach the backend from every edit tool,
// and every edit tool's input schema must be exactly the contract's fields.
// Runs against the built package: `npm run build && npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEditBody, editInputSchema } from '../dist/editContract.js';
import { TOOLS } from '../dist/server.js';

const contract = JSON.parse(readFileSync(new URL('../src/edit-contract.json', import.meta.url), 'utf8'));
const sample = { string: 'x', boolean: true, array: ['x'], object: { k: 1 } };
const valueFor = (f) => (f.schema.enum ? f.schema.enum[0] : sample[f.schema.type] ?? 'x');

for (const surface of ['all', 'queue']) {
  test(`${surface}: every contract field is forwarded to the backend where the contract places it`, () => {
    for (const f of contract.fields.filter((x) => x.surfaces.includes(surface))) {
      const body = buildEditBody({ [f.name]: valueFor(f) }, surface);
      const got = f.placement === 'param' ? body.params[f.name] : f.placement === 'project' ? body.projectId : body[f.name];
      assert.deepEqual(got, valueFor(f), `${f.name} not forwarded on ${surface}`);
    }
  });
}

test('queue_edit does not forward fields the /queue-edit route ignores', () => {
  for (const f of contract.fields.filter((x) => !x.surfaces.includes('queue'))) {
    const body = buildEditBody({ [f.name]: valueFor(f) }, 'queue');
    assert.equal(body[f.name] ?? body.params[f.name], undefined, `${f.name} leaked into queue body`);
  }
});

test('edit tools expose exactly the contract fields', () => {
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema]));
  for (const [tool, surface] of [['autonomous_edit', 'all'], ['autonomous_edit_streaming', 'all'], ['queue_edit', 'queue']]) {
    assert.deepEqual(Object.keys(byName[tool].properties).sort(), Object.keys(editInputSchema(surface).properties).sort(), tool);
  }
});

// End to end: the real stdio server, a local stub backend, every edit tool.
// Catches a handler that builds its own body instead of using buildEditBody.
import http from 'node:http';
import { spawn } from 'node:child_process';

test('every edit tool sends every contract field to the backend', async () => {
  const seen = {};
  const backend = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method === 'POST') seen[req.url.split('/').pop()] = JSON.parse(raw || '{}');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, status: 'completed', message: 'ok', taskId: 1 }));
    });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${backend.address().port}`;
  const args = (surface) => Object.fromEntries(contract.fields.filter((f) => f.surfaces.includes(surface)).map((f) => [f.name, valueFor(f)]));
  const calls = [['queue_edit', 'queue', 'queue-edit'], ['autonomous_edit', 'all', 'execute']];
  const child = spawn(process.execPath, [new URL('../dist/index.js', import.meta.url).pathname], {
    env: { ...process.env, LEVEA_API_URL: url, LEVEA_API_KEY: 'test-key-123456' }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  calls.forEach(([name, surface], i) => send({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: args(surface) } }));
  await new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (calls.every((_, i) => out.includes(`"id":${i + 1}`))) resolve(); });
    setTimeout(resolve, 8000);
  });
  child.kill(); backend.close();
  for (const [name, surface, route] of calls) {
    const body = seen[route];
    assert.ok(body, `${name} never reached /${route}`);
    for (const f of contract.fields.filter((x) => x.surfaces.includes(surface))) {
      const got = f.placement === 'param' ? body.params?.[f.name] : f.placement === 'project' ? body.projectId : body[f.name];
      assert.deepEqual(got, valueFor(f), `${name} dropped ${f.name}`);
    }
  }
});
