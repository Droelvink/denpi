export interface ToolCallInfo {
  id: string;
  name: string;
  summary: string;
}

export type AgentEvent =
  | { type: 'assistant-delta'; text: string }
  | { type: 'assistant-done'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-done'; text: string; durationMs: number }
  | { type: 'tool-start'; call: ToolCallInfo }
  | { type: 'tool-progress'; call: ToolCallInfo; text: string }
  | { type: 'tool-done'; call: ToolCallInfo; output: string; isError: boolean; durationMs: number }
  | { type: 'tool-denied'; call: ToolCallInfo }
  | { type: 'usage'; promptTokens: number; completionTokens: number; tokensPerSecond: number | null }
  | { type: 'notice'; text: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

export type EmitFn = (event: AgentEvent) => void;

export type ApprovalDecision = 'once' | 'always' | 'deny';

export type ApprovalFn = (call: ToolCallInfo, preview: string | null) => Promise<ApprovalDecision>;

export type QuestionFn = (question: string, options: string[], multiSelect: boolean) => Promise<string>;
