// Local type shim for `openclaw/plugin-sdk` so this plugin can be type-checked
// without installing the 1GB+ openclaw runtime package as a devDependency.
// At runtime the host process provides the real implementation.

declare module 'openclaw/plugin-sdk' {
  export interface AgentToolResult {
    content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType?: string }>;
    details: unknown;
  }

  export interface AgentToolDef {
    name: string;
    description: string;
    label: string;
    parameters: object;
    ownerOnly?: boolean;
    displaySummary?: string;
    execute: (
      toolCallId: string,
      params: any,
      signal?: AbortSignal,
      onUpdate?: (partial: AgentToolResult) => void,
    ) => Promise<AgentToolResult>;
  }

  export interface PluginApi {
    registerTool(tool: AgentToolDef, opts?: Record<string, unknown>): void;
    [k: string]: unknown;
  }

  export interface PluginEntryOpts {
    id: string;
    name: string;
    description: string;
    register: (api: PluginApi) => void;
    kind?: string;
    configSchema?: unknown;
    reload?: unknown;
    nodeHostCommands?: unknown;
    securityAuditCollectors?: unknown;
  }

  export function definePluginEntry(opts: PluginEntryOpts): unknown;
}
