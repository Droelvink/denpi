import type { ToolCall } from './types.js';

/**
 * Fallback parsing for tool calls that arrive as plain text because the server
 * did not (or could not) convert them into structured tool_calls — e.g. an old
 * llama.cpp build that doesn't know the model's tool-call grammar.
 *
 * Recognized formats:
 * - Qwen3-Coder XML: <tool_call><function=name><parameter=key>value</parameter>…
 * - Hermes/Qwen JSON: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
 * - bare <function=name> blocks with <parameter=…> children
 *
 * Guards: only names of registered tools are accepted, and matches inside
 * markdown code fences are ignored (the model may just be quoting an example).
 */

export interface ExtractedToolCalls {
  /** Content with the recognized call blocks removed. */
  cleaned: string;
  calls: ToolCall[];
}

export function looksLikeTextualToolCall(content: string): boolean {
  return /<tool_call>|<function=/.test(content);
}

export function extractTextualToolCalls(content: string, knownTools: readonly string[]): ExtractedToolCalls {
  const known = new Set(knownTools);
  const calls: ToolCall[] = [];
  const ranges: Array<{ start: number; end: number }> = [];

  for (const match of content.matchAll(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g)) {
    const index = match.index ?? 0;
    if (insideFence(content, index)) {
      continue;
    }
    const call = parseBlock(match[1], known);
    if (call !== null) {
      calls.push(call);
      ranges.push({ start: index, end: index + match[0].length });
    }
  }

  for (const match of content.matchAll(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/g)) {
    const index = match.index ?? 0;
    if (withinAny(ranges, index) || insideFence(content, index) || !known.has(match[1])) {
      continue;
    }
    calls.push(makeCall(match[1], parseParameters(match[2])));
    ranges.push({ start: index, end: index + match[0].length });
  }

  return { cleaned: removeRanges(content, ranges).trim(), calls };
}

function parseBlock(body: string, known: ReadonlySet<string>): ToolCall | null {
  const fn = /<function=([\w.-]+)>/.exec(body);
  if (fn !== null) {
    return known.has(fn[1]) ? makeCall(fn[1], parseParameters(body)) : null;
  }

  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const name = typeof parsed['name'] === 'string' ? parsed['name'] : null;
    if (name === null || !known.has(name)) {
      return null;
    }
    return makeCall(name, coerceArguments(parsed['arguments'] ?? parsed['parameters']));
  } catch {
    return null;
  }
}

function parseParameters(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const match of body.matchAll(/<parameter=([\w.-]+)>([\s\S]*?)(?=<parameter=|<\/function>|<\/tool_call>|$)/g)) {
    const value = match[2].replace(/<\/parameter>\s*$/, '').trim();
    args[match[1]] = coerceValue(value);
  }
  return args;
}

function coerceArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

let sequence = 0;

function makeCall(name: string, args: Record<string, unknown>): ToolCall {
  sequence += 1;
  return {
    id: `textcall_${sequence}_${Date.now()}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function insideFence(content: string, index: number): boolean {
  const fences = content.slice(0, index).match(/```/g);
  return fences !== null && fences.length % 2 === 1;
}

function withinAny(ranges: Array<{ start: number; end: number }>, index: number): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function removeRanges(content: string, ranges: Array<{ start: number; end: number }>): string {
  if (ranges.length === 0) {
    return content;
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (const range of sorted) {
    result += content.slice(cursor, range.start);
    cursor = Math.max(cursor, range.end);
  }
  return result + content.slice(cursor);
}
