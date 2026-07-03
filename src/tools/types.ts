export interface ToolContext {
  cwd: string;
  /** When true (default), file tools may not leave the workspace. */
  sandbox: boolean;
  /** Asks the user a question and resolves with their answer. */
  askUser: (question: string, options: string[], multiSelect: boolean) => Promise<string>;
  /** Snapshots a file's prior state (null = did not exist) so /undo can restore it. */
  recordUndo: (path: string, previousContent: string | null) => void;
  /** Streams a short live-progress tail to the UI while the tool runs. */
  onProgress?: (text: string) => void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
  /** When true, the user is asked before the tool runs (unless --auto). */
  requiresApproval: boolean;
  /** Short one-line description of a specific call, shown in the UI. */
  summarize(args: Record<string, unknown>): string;
  /** Optional preview (e.g. a diff) shown in the approval prompt before the call runs. */
  preview?(args: Record<string, unknown>, context: ToolContext): Promise<string | null>;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}

/** Cap applied to every tool result before it enters the conversation. */
export const MAX_TOOL_OUTPUT = 8000;

export function truncateOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT) {
    return output;
  }
  return `${output.slice(0, MAX_TOOL_OUTPUT)}\n… [truncated ${output.length - MAX_TOOL_OUTPUT} characters]`;
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required string argument "${key}"`);
  }
  return value;
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}
