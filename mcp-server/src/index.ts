#!/usr/bin/env node
/**
 * levea-mcp-server stdio binary. Single-user: backend URL and API key come
 * from LEVEA_API_URL / LEVEA_API_KEY in the MCP client's env config.
 * Tool surface lives in ./server (shared with the hosted HTTP endpoint).
 */
import * as nodeModule from 'module';

// Node ≥ 22.1 caches the compiled bundle on disk, so every later `npx` start
// skips parsing it again. No-op (and harmless) on older Node.
try {
  (nodeModule as unknown as { enableCompileCache?: () => unknown }).enableCompileCache?.();
} catch { /* ignore */ }

// ./server is kept external by the bundler: dist/index.js is a few lines over
// dist/server.js. Required after the compile cache is on.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connectStdio, createLeveaMcpServer, PKG_VERSION, TOOLS } = require('./server') as typeof import('./server');

async function main() {
  // The stdio binary runs on the user's machine: save_skill { path } may read their local SKILL.md.
  const server = createLeveaMcpServer({ localFiles: true });
  await connectStdio(server);
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
