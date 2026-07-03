import type {
  ChatCompletionChunk,
  ChatMessage,
  CompletionResult,
  ModelListResponse,
  ToolCall,
  ToolSchema,
} from './types.js';

export interface StreamRequest {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal: AbortSignal;
  onContent: (delta: string) => void;
  onReasoning: (delta: string) => void;
}

/**
 * Streams one chat completion from an OpenAI-compatible endpoint (llama-server),
 * accumulating content, reasoning, and tool-call deltas into a final result.
 */
export async function streamChatCompletion(request: StreamRequest): Promise<CompletionResult> {
  const response = await fetch(`${request.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: request.signal,
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      tools: request.tools.length > 0 ? request.tools : undefined,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`llama-server returned ${response.status}: ${truncate(body, 400)}`);
  }
  if (response.body === null) {
    throw new Error('llama-server returned an empty response body');
  }

  const result: CompletionResult = { content: '', reasoning: '', toolCalls: [], finishReason: null, stats: null };
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const startedAt = Date.now();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');

      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        continue;
      }
      applyChunk(parseChunk(payload), result, request, startedAt);
    }
  }

  return result;
}

/** Returns the ids of the models the server offers, or [] if unreachable. */
export async function fetchModelIds(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      return [];
    }
    const parsed = (await response.json()) as ModelListResponse;
    return (parsed.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function parseChunk(payload: string): ChatCompletionChunk {
  try {
    return JSON.parse(payload) as ChatCompletionChunk;
  } catch {
    return {};
  }
}

function applyChunk(
  chunk: ChatCompletionChunk,
  result: CompletionResult,
  request: StreamRequest,
  startedAt: number,
): void {
  if (chunk.error?.message !== undefined) {
    throw new Error(`llama-server error: ${chunk.error.message}`);
  }
  if (chunk.usage !== undefined && chunk.usage !== null) {
    const completionTokens = chunk.usage.completion_tokens ?? 0;
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    result.stats = {
      promptTokens: chunk.usage.prompt_tokens ?? 0,
      completionTokens,
      tokensPerSecond:
        chunk.timings?.predicted_per_second ??
        (completionTokens > 0 && elapsedSeconds > 0 ? completionTokens / elapsedSeconds : null),
    };
  }
  const choice = chunk.choices?.[0];
  if (choice === undefined) {
    return;
  }

  if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
    result.finishReason = choice.finish_reason;
  }

  const delta = choice.delta;
  if (typeof delta.content === 'string' && delta.content.length > 0) {
    result.content += delta.content;
    request.onContent(delta.content);
  }
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    result.reasoning += delta.reasoning_content;
    request.onReasoning(delta.reasoning_content);
  }

  for (const fragment of delta.tool_calls ?? []) {
    const index = fragment.index ?? 0;
    let call: ToolCall | undefined = result.toolCalls[index];
    if (call === undefined) {
      call = { id: `call_${index}`, type: 'function', function: { name: '', arguments: '' } };
      result.toolCalls[index] = call;
    }
    if (fragment.id !== undefined) {
      call.id = fragment.id;
    }
    if (fragment.function?.name !== undefined) {
      call.function.name += fragment.function.name;
    }
    if (fragment.function?.arguments !== undefined) {
      call.function.arguments += fragment.function.arguments;
    }
  }
}

/** Reads the server's context window size from llama-server's /props, or null. */
export async function fetchContextSize(baseUrl: string): Promise<number | null> {
  try {
    const root = baseUrl.replace(/\/v1$/, '');
    const response = await fetch(`${root}/props`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      return null;
    }
    const parsed = (await response.json()) as { default_generation_settings?: { n_ctx?: number } };
    const contextSize = parsed.default_generation_settings?.n_ctx;
    return typeof contextSize === 'number' && contextSize > 0 ? contextSize : null;
  } catch {
    return null;
  }
}

/** Trims a model id (often a GGUF file path) down to a display-friendly name. */
export function shortModelName(id: string): string {
  const basename = id.split(/[\\/]/).pop() ?? id;
  return basename.replace(/\.gguf$/i, '');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
