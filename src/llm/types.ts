/** OpenAI-compatible chat wire types, as served by llama-server. */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallFunction {
  name: string;
  /** JSON-encoded arguments, exactly as the model produced them. */
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Incremental tool-call fragment inside a streaming delta. */
export interface ToolCallDelta {
  index?: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChunkDelta {
  role?: Role;
  content?: string | null;
  /** llama.cpp emits reasoning for thinking models under this key. */
  reasoning_content?: string | null;
  tool_calls?: ToolCallDelta[];
}

export interface ChunkChoice {
  index: number;
  delta: ChunkDelta;
  finish_reason: string | null;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** llama.cpp-specific performance block sent with the final chunk. */
export interface Timings {
  prompt_n?: number;
  predicted_n?: number;
  predicted_per_second?: number;
}

export interface ChatCompletionChunk {
  id?: string;
  choices?: ChunkChoice[];
  usage?: Usage | null;
  timings?: Timings;
  error?: { message?: string };
}

export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond: number | null;
}

export interface CompletionResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  stats: TokenStats | null;
}

export interface ModelListResponse {
  data?: Array<{ id?: string }>;
}
