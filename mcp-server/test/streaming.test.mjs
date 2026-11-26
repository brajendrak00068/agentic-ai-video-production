// Edit calls against a backend that streams like the real one: heartbeats and
// keep-alive bytes keep the connection busy, error events carry no
// success:false, events may be CRLF-framed, and a closing JSON payload may
// follow the last event. Runs against the built package: `npm run build && npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

function backend(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function callTool(url, tool, args, env = {}) {
  const child = spawn(process.execPath, [new URL('../dist/index.js', import.meta.url).pathname], {
    env: { ...process.env, LEVEA_API_URL: url, LEVEA_API_KEY: 'test-key-123456', LEVEA_TELEMETRY: 'off', ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  try {
    return await new Promise((resolve, reject) => {
      let buf = '';
      const guard = setTimeout(() => reject(new Error(`${tool} did not answer`)), 15_000);
      child.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n').slice(0, -1)) {
          try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(guard); resolve(m.result); } } catch { /* partial */ }
        }
        buf = buf.split('\n').pop();
      });
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
    });
  } finally {
    child.kill();
  }
}

test('a streamed error event is a tool error, and the call ends without waiting for the socket to close', async () => {
  const server = await backend((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"type":"error","message":"boom"}\n\n');
    setInterval(() => res.write(': ping\n\n'), 100).unref(); // never ends, like the real error path
  });
  const r = await callTool(`http://127.0.0.1:${server.address().port}`, 'autonomous_edit_streaming', { prompt: 'x' });
  server.closeAllConnections(); server.close();
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.success, false);
});

test('CRLF-framed events and the closing JSON payload are read', async () => {
  const server = await backend((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"type":"success","success":true,"message":"event"}\r\n\r\n');
    res.end('{"success":true,"message":"final","videoUrl":"https://v/final.mp4"}');
  });
  const r = await callTool(`http://127.0.0.1:${server.address().port}`, 'autonomous_edit_streaming', { prompt: 'x' });
  server.close();
  assert.equal(r.isError ?? false, false);
  assert.equal(r.structuredContent.videoUrl, 'https://v/final.mp4');
});

for (const tool of ['autonomous_edit', 'autonomous_edit_streaming']) {
  test(`${tool} returns "running" (not an error) when a kept-alive edit outlives the wait`, async () => {
    const server = await backend((req, res) => {
      const sse = (req.headers.accept || '').includes('text/event-stream');
      res.writeHead(200, { 'content-type': sse ? 'text/event-stream' : 'application/json' });
      const t = setInterval(() => res.write(sse ? ': ping\n\n' : ' '), 100);
      req.on('close', () => clearInterval(t));
    });
    const r = await callTool(`http://127.0.0.1:${server.address().port}`, tool, { prompt: 'x' },
      { LEVEA_REQUEST_TIMEOUT_MS: '1500', LEVEA_STREAM_TIMEOUT_MS: '1500' });
    server.closeAllConnections(); server.close();
    assert.equal(r.isError ?? false, false);
    assert.equal(r.structuredContent.status, 'running');
    assert.ok(String(r.structuredContent.raw.projectId).startsWith('mcp_'));
  });
}

test('check_job_status wait stops on a 4xx instead of polling to the deadline', async () => {
  let polls = 0;
  const server = await backend((req, res) => { polls++; res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"success":false,"error":"invalid key"}'); });
  const r = await callTool(`http://127.0.0.1:${server.address().port}`, 'check_job_status', { job_id: '1', wait: true });
  server.close();
  assert.equal(r.isError, true);
  assert.equal(polls, 1);
});

test('a tool result carries its data as text too, so a client that reads only text still gets the upload URL', async () => {
  const server = await backend((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, uploadUrl: 'https://signed.example/put?sig=abc', fileUrl: 'https://cdn.example/clip.mp4' }));
  });
  const r = await callTool(`http://127.0.0.1:${server.address().port}`, 'asset_upload_url', { fileName: 'clip.mp4' });
  server.closeAllConnections(); server.close();
  assert.equal(r.structuredContent.uploadUrl, 'https://signed.example/put?sig=abc');
  const text = r.content.map((c) => c.text).join('\n');
  assert.ok(text.includes('https://signed.example/put?sig=abc'), 'upload URL missing from the text content');
  assert.ok(text.includes('https://cdn.example/clip.mp4'), 'file URL missing from the text content');
  assert.equal(r.content[0].type, 'text');
  assert.ok(r.content.length >= 2, 'summary and data should be separate text blocks');
});

test('a finished export link stays whole in the text when the result is digested', async () => {
  // A presigned link is ~600 chars; cut short it loses its signature and does not open.
  const link = `https://bucket.example/exports/out_mastered.mp4?X-Amz-Credential=${'c'.repeat(300)}&X-Amz-Signature=${'f'.repeat(64)}`;
  const server = await backend((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      success: true, taskId: '42', status: 'completed', videoUrl: link,
      progress: { message: 'x'.repeat(9000), videoUrl: link, clips: [{ url: link }] },
    }));
  });
  const r = await callTool(`http://127.0.0.1:${server.address().port}`, 'check_task_status', { task_id: '42' });
  server.closeAllConnections(); server.close();
  assert.ok(r.content[0].text.includes(`📹 ${link}`), 'the summary line should carry the whole link');
  const data = r.content.slice(1).map((c) => c.text).join('\n');
  assert.ok(data.includes('digest of'), 'the result should have been digested');
  assert.ok(data.includes(link), 'the digest should keep the link whole');
});

test('a gateway 504 on a direct call says the call may still be running', async () => {
  const server = await backend((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(504, { 'content-type': 'text/html' }); res.end('<html>504 Gateway Time-out</html>'); });
  });
  const r = await callTool(`http://127.0.0.1:${server.address().port}`, 'execute_action', { project_id: 'p1', action: 'TRIM_LAYER', action_params: {} });
  server.closeAllConnections(); server.close();
  assert.equal(r.isError, true);
  const text = r.content.map((c) => c.text).join('\n');
  assert.ok(text.includes('HTTP 504'), text);
  assert.ok(text.includes('may still be running on Levea'), text);
  assert.ok(text.includes('an identical resend waits for it and is never applied twice'), text);
});

test('an export step that answered "still rendering" is followed by the job outcome this call waited for', async () => {
  const server = await backend((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'POST') {
        res.end(JSON.stringify({
          success: true, status: 'rendering', jobId: '77', action: 'EXPORT_VIDEO', projectId: 'p1',
          stepReceipts: [{ action: 'EXPORT_VIDEO', success: true, observation: 'Video export still rendering after 30s. Job is in flight.' }],
        }));
      } else {
        res.end(JSON.stringify({ success: true, jobId: '77', status: 'completed', progress: 100, videoUrl: 'https://cdn.example/out.mp4' }));
      }
    });
  });
  const r = await callTool(`http://127.0.0.1:${server.address().port}`, 'execute_action', { project_id: 'p1', action: 'EXPORT_VIDEO', action_params: {} });
  server.closeAllConnections(); server.close();
  const text = r.content[0].text;
  assert.ok(text.includes('✅ EXPORT_VIDEO: Video export still rendering after 30s'), text);
  assert.ok(text.includes('↳ export job 77: completed after that receipt (this call waited for it)'), text);
  assert.ok(text.includes('📹 https://cdn.example/out.mp4'), text);
});
