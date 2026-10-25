#!/usr/bin/env node
/**
 * levea-mcp-server stdio binary. Single-user: backend URL and API key come
 * from LEVEA_API_URL / LEVEA_API_KEY in the MCP client's env config.
 * Tool surface lives in ./server (shared with the hosted HTTP endpoint).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLeveaMcpServer, PKG_VERSION, TOOLS } from './server';

async function main() {
  const server = createLeveaMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `levea-mcp-server ${PKG_VERSION} ready (${TOOLS.length} tools)\n`
  );
}

main().catch((err) => {
  process.stderr.write(
    `levea-mcp-server fatal: ${err instanceof Error ? err.stack : String(err)}\n`
  );
  process.exit(1);
});
