#!/usr/bin/env node
/**
 * levea-mcp-http-server — hosted (multi-tenant) Streamable HTTP binary.
 *
 * Serves many users from one process. Each request's caller identity comes
 * from the inbound `Authorization: Bearer <LEVEA_API_KEY>` header and is
 * scoped via `runWithLeveaConfig`, which never falls back to a shared env
 * key (see client.ts). A missing key reaches the tools, which answer with
 * the guided "generate a key + send it as Bearer" error — that message is
 * part of the connector surface, so we do not short-circuit it here.
 *
 * Config (env):
 *   PORT                    listen port (default 8080)
 *   HOST                    bind host (default 0.0.0.0)
 *   LEVEA_MCP_PATH          MCP route path (default /mcp)
 *   LEVEA_API_URL           backend host (default https://api.livecore.ai)
 *   LEVEA_HTTP_TIMEOUT_MS   per-request wall clock (default 1_900_000, above
 *                           LEVEA_STREAM_TIMEOUT_MS so streaming edits fit)
 *   LEVEA_MAX_BODY_BYTES    max JSON-RPC body (default 4 MiB)
 *
 * Never log request headers or bodies: they carry user API keys and prompts.
 */
import * as http from 'http';
import { handleLeveaMcpHttpRequest } from './http';
import type { LeveaClientConfig } from './client';
import { PKG_VERSION, TOOLS } from './server';

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PORT = envNum('PORT', 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MCP_PATH = process.env.LEVEA_MCP_PATH || '/mcp';
const MAX_BODY_BYTES = envNum('LEVEA_MAX_BODY_BYTES', 4 * 1024 * 1024);
const REQUEST_TIMEOUT_MS = envNum('LEVEA_HTTP_TIMEOUT_MS', 1_900_000);

function bearerToken(req: http.IncomingMessage): string | undefined {
  const raw = req.headers.authorization;
  if (!raw || !raw.startsWith('Bearer ')) return undefined;
  const token = raw.slice('Bearer '.length).trim();
  return token || undefined;
}

type BodyResult = { ok: true; body: unknown } | { ok: false; status: number; error: string };

function readJsonBody(req: http.IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve({ ok: false, status: 413, error: 'payload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        resolve({ ok: false, status: 400, error: 'empty body: send a JSON-RPC request' });
        return;
      }
      try {
        resolve({ ok: true, body: JSON.parse(text) });
      } catch {
        resolve({ ok: false, status: 400, error: 'invalid JSON body' });
      }
    });
    req.on('error', () => resolve({ ok: false, status: 400, error: 'request stream error' }));
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: Record<string, unknown>): void {
  if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function main(): Promise<void> {
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      // Access log: method, route, status, latency only. Never headers/bodies.
      const route = (req.url || '').split('?')[0];
      process.stderr.write(
        `${new Date().toISOString()} ${req.method} ${route} ${res.statusCode} ${Date.now() - started}ms\n`
      );
    });

    const route = (req.url || '').split('?')[0];

    if (req.method === 'GET' && route === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'levea-mcp-server',
        version: PKG_VERSION,
        transport: 'streamable-http',
        tools: TOOLS.length,
        mcpPath: MCP_PATH,
      });
      return;
    }

    if (route === MCP_PATH) {
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        sendJson(res, 405, {
          error: 'method not allowed: this endpoint is stateless Streamable HTTP — send JSON-RPC via POST',
        });
        return;
      }
      const parsed = await readJsonBody(req);
      if (!parsed.ok) {
        sendJson(res, parsed.status, { error: parsed.error });
        return;
      }
      const config: LeveaClientConfig = {
        apiKey: bearerToken(req),
        // Scoped mode never reads process env, so pass the server-level backend
        // host through explicitly. The API key is never taken from env here.
        apiUrl: process.env.LEVEA_API_URL || process.env.ADSCENE_API_URL,
        clientLabel: 'levea-mcp-hosted',
      };
      try {
        await handleLeveaMcpHttpRequest(req, res, parsed.body, config);
      } catch (err) {
        sendJson(res, 500, { error: 'internal error' });
        process.stderr.write(
          `levea-mcp-http-server handler error: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
      return;
    }

    sendJson(res, 404, { error: 'not found', endpoints: { mcp: MCP_PATH, health: '/health' } });
  });

  // Streaming edits can legitimately hold a POST for many minutes; give the
  // request wall clock headroom above LEVEA_STREAM_TIMEOUT_MS.
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = 65_000;

  const shutdown = (signal: string) => {
    process.stderr.write(`levea-mcp-http-server ${signal}: draining\n`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server.listen(PORT, HOST, () => {
    process.stderr.write(
      `levea-mcp-http-server ${PKG_VERSION} listening on http://${HOST}:${PORT}${MCP_PATH} ` +
        `(${TOOLS.length} tools, health at /health)\n`
    );
  });
}

main().catch((err) => {
  process.stderr.write(
    `levea-mcp-http-server fatal: ${err instanceof Error ? err.stack : String(err)}\n`
  );
  process.exit(1);
});
