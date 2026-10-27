// Edit-request contract, driven by edit-contract.json.
//
// Source: contract/editContract.ts + contract/edit-contract.json (the single
// source of truth). mcp-server/src/ holds generated copies — edit the files in
// contract/ and run `node scripts/sync-contract.mjs`. Both the tool input
// schemas and the backend request bodies are
// built by looping over its fields, so a field added there reaches every edit
// tool automatically and no tool can forget to forward one.

import contract from './edit-contract.json';

export type EditSurface = 'all' | 'queue';
type Placement = 'param' | 'top' | 'project';

interface ContractField {
  name: string;
  placement: Placement;
  surfaces: string[];
  doc: string;
  schema: Record<string, unknown> & { type?: string };
}

const FIELDS = contract.fields as ContractField[];
const REQUIRED = contract.required as string[];

function fieldsFor(surface: EditSurface): ContractField[] {
  return FIELDS.filter((f) => f.surfaces.includes(surface));
}

/** JSON Schema for an edit tool's input on the given surface. */
export function editInputSchema(surface: EditSurface): Record<string, unknown> {
  const fields = fieldsFor(surface);
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map((f) => [f.name, f.schema])),
    required: REQUIRED.filter((name) => fields.some((f) => f.name === name)),
  };
}

// Normalises a value by its declared JSON type; undefined means "omit".
function normalize(field: ContractField, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  switch (field.schema.type) {
    case 'string':
      return typeof value === 'string' && value.trim() === '' ? undefined : String(value);
    case 'boolean':
      return Boolean(value);
    case 'array':
      return Array.isArray(value) && value.length > 0 ? value : undefined;
    default:
      return value;
  }
}

/**
 * Backend request body for an edit (`/execute` or `/queue-edit`), built from
 * the tool input. Fields go where the contract places them: `params`, the top
 * level, or projectId/project_id.
 */
export function buildEditBody(input: Record<string, unknown>, surface: EditSurface): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const body: Record<string, unknown> = { tool: 'autonomous_edit', params };
  for (const field of fieldsFor(surface)) {
    const value = normalize(field, input[field.name]);
    if (value === undefined) continue;
    if (field.placement === 'param') params[field.name] = value;
    else if (field.placement === 'project') {
      body.projectId = value;
      body.project_id = value;
    } else body[field.name] = value;
  }
  return body;
}
