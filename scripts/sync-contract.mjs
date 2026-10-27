#!/usr/bin/env node
// Propagates contract/edit-contract.json (the single source of truth for edit
// request fields) to every place that needs it.
//
//   node scripts/sync-contract.mjs          rewrite all generated copies
//   node scripts/sync-contract.mjs --check  exit 1 if any copy is stale (CI / prepublish)
//
// Copies: mcp-server/src/{edit-contract.json,editContract.ts}, hermes-plugin/edit_contract.json
// (the OpenClaw plugin imports contract/edit-contract.json directly).
// Generated docs: the "Tool parameters" list in every SKILL.md, the request
// field table in mcp-server/README.md, and the ChatGPT OpenAPI specs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SOURCE = 'contract/edit-contract.json';
const contractText = fs.readFileSync(path.join(ROOT, SOURCE), 'utf8');
const contract = JSON.parse(contractText);
const required = new Set(contract.required);
const on = (surface) => contract.fields.filter((f) => f.surfaces.includes(surface));

const START = '<!-- edit-contract:start (generated from contract/edit-contract.json — edit that file, then run node scripts/sync-contract.mjs) -->';
const END = '<!-- edit-contract:end -->';

const outputs = new Map(); // relative path -> expected content

// 1. Verbatim copies for packages that ship their own folder.
outputs.set('mcp-server/src/edit-contract.json', contractText);
outputs.set('mcp-server/src/editContract.ts', fs.readFileSync(path.join(ROOT, 'contract/editContract.ts'), 'utf8'));
outputs.set('hermes-plugin/edit_contract.json', contractText);

// Replaces the marked block, or on first run the block that starts at `heading`
// and runs while lines satisfy `isBodyLine`.
function replaceBlock(text, file, generated, heading, isBodyLine) {
  const block = `${START}\n${generated}\n${END}`;
  const s = text.indexOf(START);
  if (s !== -1) {
    const e = text.indexOf(END, s);
    if (e === -1) throw new Error(`${file}: start marker without end marker`);
    return text.slice(0, s) + block + text.slice(e + END.length);
  }
  const lines = text.split('\n');
  const h = lines.findIndex((l) => l.trim() === heading);
  if (h === -1) return null;
  let a = h + 1;
  while (a < lines.length && lines[a].trim() === '') a++;
  let b = a;
  while (b < lines.length && isBodyLine(lines[b])) b++;
  if (b === a) throw new Error(`${file}: no field list found under "${heading}"`);
  return [...lines.slice(0, a), block, ...lines.slice(b)].join('\n');
}

// 2. Skill parameter lists.
const typeOf = (f) => (f.schema.enum ? 'string' : f.schema.type || 'any');
const skillList = on('all')
  .map((f) => `- \`${f.name}\` (${typeOf(f)}, ${required.has(f.name) ? 'required' : 'optional'}): ${f.doc}`)
  .join('\n');
function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(rel);
    return d.name === 'SKILL.md' ? [rel] : [];
  });
}
for (const file of walk('skills')) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const next = replaceBlock(text, file, skillList, '### Tool parameters', (l) => l.startsWith('- `'));
  if (next !== null) outputs.set(file, next);
}

// 3. mcp-server README request-field table.
{
  const file = 'mcp-server/README.md';
  const rows = on('all').map((f) => `| \`${f.name}\` | ${f.doc}${required.has(f.name) ? ' (**required**)' : ''} |`);
  const table = ['| Field | What it does |', '|---|---|', ...rows].join('\n');
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let next;
  if (text.includes(START)) next = replaceBlock(text, file, table, '', () => false);
  else {
    // First run: wrap the existing table that documents `prompt`.
    const lines = text.split('\n');
    const row = lines.findIndex((l) => l.startsWith('| `prompt` |'));
    if (row === -1) throw new Error(`${file}: request field table not found`);
    let a = row; while (a > 0 && lines[a - 1].startsWith('|')) a--;
    let b = row; while (b < lines.length && lines[b].startsWith('|')) b++;
    next = [...lines.slice(0, a), `${START}\n${table}\n${END}`, ...lines.slice(b)].join('\n');
  }
  outputs.set(file, next);
}

// 4. ChatGPT OpenAPI specs: params of the execute operation.
for (const file of ['chatgpt/openapi.json', 'LEVEA_CHATGPT_ACTION_SPEC.json']) {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const op = spec.paths['/api/v1/misc/openclaw/v1/execute'].post;
  const params = op.requestBody.content['application/json'].schema.properties.params;
  const fields = on('openapi');
  params.properties = Object.fromEntries(fields.map((f) => [f.name, f.schema]));
  params.required = contract.required.filter((n) => fields.some((f) => f.name === n));
  outputs.set(file, `${JSON.stringify(spec, null, 2)}\n`);
}

// Write or check.
const stale = [];
for (const [file, content] of outputs) {
  const abs = path.join(ROOT, file);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (current === content) continue;
  stale.push(file);
  if (!CHECK) fs.writeFileSync(abs, content);
}
if (CHECK && stale.length) {
  console.error(`✗ edit contract out of sync. Run: node scripts/sync-contract.mjs\n  stale: ${stale.join(', ')}`);
  process.exit(1);
}
console.log(CHECK ? `✓ edit contract in sync (${outputs.size} files)` : `✓ synced ${stale.length} of ${outputs.size} files from ${SOURCE}`);
