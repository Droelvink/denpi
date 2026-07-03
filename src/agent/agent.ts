import type { DenpiConfig } from '../config.js';
import { describeError } from '../errors.js';
import { streamChatCompletion } from '../llm/client.js';
import { extractTextualToolCalls, looksLikeTextualToolCall } from '../llm/textual-tool-calls.js';
import type { ChatMessage, ToolCall, ToolSchema } from '../llm/types.js';
import { findTool, toolSchemas } from '../tools/registry.js';
import { UndoStore } from '../undo.js';
import type { ToolDefinition } from '../tools/types.js';
import { truncateOutput } from '../tools/types.js';
import type { AgentEvent, ApprovalFn, EmitFn, QuestionFn, ToolCallInfo } from './events.js';
import { buildSystemPrompt } from './system-prompt.js';

const MAX_STEPS = 24;

// Compaction (omp-style "snapcompact"): deterministic, no model call.
const COMPACT_FALLBACK_KEEP_TOKENS = 6000;
const DIGEST_HEAD_CHARS = 1200;
const DIGEST_TAIL_CHARS = 800;
const REQUEST_LINE_CHARS = 150;
const MAX_REQUEST_LINES = 12;

export interface AgentOptions {
  config: DenpiConfig;
  tools: ToolDefinition[];
  requestApproval: ApprovalFn;
  requestQuestion: QuestionFn;
}

/**
 * The agent loop: stream a completion, execute any tool calls, feed results
 * back, and repeat until the model answers without tools.
 */
export class Agent {
  private readonly history: ChatMessage[] = [];
  private readonly schemas: ToolSchema[];
  /** When true (/permissions off), every tool call runs without asking. */
  private permissionsBypassed = false;
  readonly undo = new UndoStore();
  private model: string;

  constructor(private readonly options: AgentOptions) {
    this.history.push({ role: 'system', content: buildSystemPrompt(options.config) });
    this.schemas = toolSchemas(options.tools);
    this.model = options.config.model;
  }

  /** Switches the model requested from the server for subsequent turns. */
  setModel(model: string): void {
    this.model = model;
  }

  reset(): void {
    this.history.length = 1;
  }

  /**
   * Deterministic compaction, modeled on omp's "snapcompact" strategy: instant,
   * local, free — no model call. Keeps the most recent turns verbatim (cut only
   * at a user-turn boundary so tool-call/result pairs never split) and replaces
   * everything older with a mechanically built archive entry: earlier requests,
   * a file-operations list, and a head+tail digest of prior responses.
   * Returns null when everything already fits in the keep budget.
   */
  compact(contextSize: number | null): { folded: number; kept: number } | null {
    if (this.history.length < 3) {
      return null;
    }

    const keepBudget =
      contextSize !== null ? Math.max(1000, Math.floor(contextSize / 4)) : COMPACT_FALLBACK_KEEP_TOKENS;

    // Walk backwards to find the earliest user-turn start whose suffix fits the budget.
    let cut = -1;
    let accumulated = 0;
    for (let i = this.history.length - 1; i >= 1; i--) {
      accumulated += estimateTokens(this.history[i]);
      if (accumulated > keepBudget) {
        break;
      }
      if (this.history[i].role === 'user') {
        cut = i;
      }
    }
    if (cut === 1) {
      return null;
    }

    const foldEnd = cut === -1 ? this.history.length : cut;
    const folded = this.history.slice(1, foldEnd);
    if (folded.length === 0) {
      return null;
    }
    const tail = this.history.slice(foldEnd);

    const archive = buildArchiveSummary(folded);
    this.history.length = 1;
    this.history.push({ role: 'user', content: archive });
    this.history.push({ role: 'assistant', content: 'Understood — continuing with the retained context.' });
    this.history.push(...tail);
    return { folded: folded.length, kept: tail.length };
  }

  setPermissionsBypassed(bypassed: boolean): void {
    this.permissionsBypassed = bypassed;
  }

  async run(userText: string, emit: EmitFn, signal: AbortSignal): Promise<void> {
    this.history.push({ role: 'user', content: userText });

    let partialContent = '';
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        partialContent = '';
        let reasoningStartedAt = 0;

        const result = await streamChatCompletion({
          baseUrl: this.options.config.baseUrl,
          model: this.model,
          messages: this.history,
          tools: this.schemas,
          signal,
          onContent: (delta: string): void => {
            partialContent += delta;
            emit({ type: 'assistant-delta', text: delta });
          },
          onReasoning: (delta: string): void => {
            if (reasoningStartedAt === 0) {
              reasoningStartedAt = Date.now();
            }
            emit({ type: 'reasoning-delta', text: delta });
          },
        });

        if (reasoningStartedAt !== 0) {
          emit({ type: 'reasoning-done', text: result.reasoning, durationMs: Date.now() - reasoningStartedAt });
        }
        if (result.stats !== null) {
          emit({
            type: 'usage',
            promptTokens: result.stats.promptTokens,
            completionTokens: result.stats.completionTokens,
            tokensPerSecond: result.stats.tokensPerSecond,
          });
        }

        let content = result.content;
        let rawCalls = result.toolCalls;
        if (rawCalls.length === 0 && content.length > 0 && looksLikeTextualToolCall(content)) {
          // The server passed the model's tool call through as plain text — recover it.
          const extracted = extractTextualToolCalls(
            content,
            this.options.tools.map((tool) => tool.name),
          );
          if (extracted.calls.length > 0) {
            rawCalls = extracted.calls;
            content = extracted.cleaned;
            emit({
              type: 'notice',
              text: `recovered ${extracted.calls.length} text-format tool call(s) — the server did not emit structured tool_calls (check --jinja and your llama.cpp version)`,
            });
          } else {
            emit({
              type: 'notice',
              text: 'the reply looks like an attempted tool call the server could not parse — check --jinja and your llama.cpp version',
            });
          }
        }

        const toolCalls = prepareToolCalls(rawCalls);
        this.history.push({
          role: 'assistant',
          content: content.length > 0 ? content : null,
          tool_calls: toolCalls.length > 0 ? toolCalls.map((prepared) => prepared.call) : undefined,
        });
        if (content.length > 0) {
          emit({ type: 'assistant-done', text: content });
        }

        if (toolCalls.length === 0) {
          return;
        }
        for (const prepared of toolCalls) {
          this.history.push(await this.handleToolCall(prepared, emit));
        }
      }
      emit({ type: 'error', message: `stopped after ${MAX_STEPS} steps without a final answer` });
    } catch (error) {
      if (signal.aborted) {
        // Keep history consistent: record whatever the model said before the cut.
        this.history.push({ role: 'assistant', content: partialContent.length > 0 ? partialContent : '(cancelled)' });
        emit({ type: 'cancelled' });
        return;
      }
      emit({ type: 'error', message: describeError(error) });
    }
  }

  private async handleToolCall(prepared: PreparedToolCall, emit: EmitFn): Promise<ChatMessage> {
    const { call, args } = prepared;
    const tool = findTool(call.function.name);
    const info: ToolCallInfo = {
      id: call.id,
      name: call.function.name,
      summary: tool !== undefined && args !== null ? tool.summarize(args) : call.function.arguments.slice(0, 120),
    };

    const output = await this.executeTool(tool, args, info, emit);
    return { role: 'tool', tool_call_id: call.id, content: output };
  }

  private async executeTool(
    tool: ToolDefinition | undefined,
    args: Record<string, unknown> | null,
    info: ToolCallInfo,
    emit: EmitFn,
  ): Promise<string> {
    if (tool === undefined) {
      const message = `Error: unknown tool "${info.name}"`;
      emit(toolDoneEvent(info, message, true, 0));
      return message;
    }
    if (args === null) {
      const message = 'Error: the tool arguments were not valid JSON. Call the tool again with corrected arguments.';
      emit(toolDoneEvent(info, message, true, 0));
      return message;
    }

    const context = {
      cwd: this.options.config.cwd,
      sandbox: this.options.config.sandbox,
      askUser: this.options.requestQuestion,
      recordUndo: (path: string, previousContent: string | null): void => this.undo.record(path, previousContent),
      onProgress: (text: string): void => emit({ type: 'tool-progress', call: info, text }),
    };

    let needsApproval = true;
    try {
      needsApproval = tool.needsApproval(args, context);
    } catch {
      // if the check itself fails, err on the side of asking
    }
    if (needsApproval && !this.permissionsBypassed) {
      let preview: string | null = null;
      if (tool.preview !== undefined) {
        try {
          preview = await tool.preview(args, context);
        } catch {
          preview = null;
        }
      }
      const decision = await this.options.requestApproval(info, preview);
      if (decision === 'deny') {
        emit({ type: 'tool-denied', call: info });
        return 'The user denied this tool call. Ask before retrying, or try another approach.';
      }
    }

    emit({ type: 'tool-start', call: info });
    const startedAt = Date.now();
    try {
      const output = truncateOutput(await tool.execute(args, context));
      emit(toolDoneEvent(info, output, false, Date.now() - startedAt));
      return output;
    } catch (error) {
      const message =
        `Error: ${describeError(error)}\n` +
        'The call failed — adjust it and try again, or take a different approach.';
      emit(toolDoneEvent(info, message, true, Date.now() - startedAt));
      return message;
    }
  }
}

interface PreparedToolCall {
  call: ToolCall;
  args: Record<string, unknown> | null;
}

/**
 * Makes streamed tool calls safe to store in history: drops holes left by
 * sparse stream indexes and replaces unparseable argument strings with "{}",
 * since llama-server's chat template JSON-parses arguments on every following
 * request and a broken entry would 500 the rest of the conversation.
 */
function prepareToolCalls(raw: ToolCall[]): PreparedToolCall[] {
  const prepared: PreparedToolCall[] = [];
  for (const call of raw) {
    if (call === undefined || call === null || call.function.name.length === 0) {
      continue;
    }
    const args = parseArguments(call.function.arguments);
    if (args === null) {
      call.function.arguments = '{}';
    }
    prepared.push({ call, args });
  }
  return prepared;
}

/** Rough token estimate (chars/4) — good enough to place the compaction cut. */
function estimateTokens(message: ChatMessage): number {
  let chars = message.content?.length ?? 0;
  for (const call of message.tool_calls ?? []) {
    chars += call.function.name.length + call.function.arguments.length + 20;
  }
  return Math.ceil(chars / 4) + 4;
}

function buildArchiveSummary(folded: ChatMessage[]): string {
  const requests: string[] = [];
  const fileOps = new Map<string, { read: boolean; write: boolean }>();
  const assistantText: string[] = [];

  for (const message of folded) {
    if (message.role === 'user' && message.content !== null && message.content.length > 0) {
      requests.push(truncateLine(message.content, REQUEST_LINE_CHARS));
    }
    if (message.role === 'assistant') {
      if (message.content !== null && message.content.length > 0) {
        assistantText.push(message.content);
      }
      for (const call of message.tool_calls ?? []) {
        recordFileOp(fileOps, call);
      }
    }
  }

  const sections: string[] = [
    '(conversation compacted) Older messages were archived out of context. Digest of what was removed:',
  ];
  if (requests.length > 0) {
    const shown = requests.slice(-MAX_REQUEST_LINES);
    sections.push(`Earlier user requests:\n${shown.map((line) => `- ${line}`).join('\n')}`);
  }
  if (fileOps.size > 0) {
    const lines = [...fileOps.entries()].map(([path, op]) => {
      const marker = op.read && op.write ? '(RW)' : op.write ? '(Write)' : '(Read)';
      return `- ${path} ${marker}`;
    });
    sections.push(`Files touched:\n${lines.join('\n')}`);
  }
  const digest = headTail(assistantText.join('\n\n'), DIGEST_HEAD_CHARS, DIGEST_TAIL_CHARS);
  if (digest.length > 0) {
    sections.push(`Earlier responses (head/tail digest):\n${digest}`);
  }
  return sections.join('\n\n');
}

function recordFileOp(fileOps: Map<string, { read: boolean; write: boolean }>, call: ToolCall): void {
  const name = call.function.name;
  const isRead = name === 'read_file';
  const isWrite = name === 'write_file' || name === 'edit_file';
  if (!isRead && !isWrite) {
    return;
  }
  const args = parseArguments(call.function.arguments);
  const path = args !== null && typeof args['path'] === 'string' ? args['path'] : null;
  if (path === null) {
    return;
  }
  const entry = fileOps.get(path) ?? { read: false, write: false };
  if (isRead) {
    entry.read = true;
  } else {
    entry.write = true;
  }
  fileOps.set(path, entry);
}

function headTail(text: string, head: number, tail: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= head + tail) {
    return trimmed;
  }
  return `${trimmed.slice(0, head)}\n… [${trimmed.length - head - tail} characters archived] …\n${trimmed.slice(-tail)}`;
}

function truncateLine(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function toolDoneEvent(call: ToolCallInfo, output: string, isError: boolean, durationMs: number): AgentEvent {
  return { type: 'tool-done', call, output, isError, durationMs };
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw.length > 0 ? raw : '{}');
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
