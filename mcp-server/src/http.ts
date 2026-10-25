/**
 * Hosted (multi-tenant) Streamable HTTP entry point for the Levea MCP tools.
 *
 * Stateless by design: every HTTP request gets a fresh Server + transport and
 * runs inside `runWithLeveaConfig` with the caller's own API key, so nothing is
 * shared between users or kept in process memory between requests. That makes
 * it safe behind a load balancer with any number of replicas.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLeveaMcpServer } from './server';
import { runWithLeveaConfig, type LeveaClientConfig } from './client';

export async function handleLeveaMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
  config: LeveaClientConfig
): Promise<void> {
  await runWithLeveaConfig(config, async () => {
    const server = createLeveaMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  });
}
