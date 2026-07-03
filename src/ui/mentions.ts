import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_ATTACH_CHARS = 8000;

export interface ExpandedMessage {
  /** Message text with attached file contents appended. */
  text: string;
  /** Paths that were successfully attached. */
  attached: string[];
}

/**
 * Expands "@path" mentions: each one that resolves to a readable file gets its
 * content appended to the message as a fenced block. Unresolvable mentions are
 * left in the text untouched.
 */
export function expandMentions(text: string, cwd: string): ExpandedMessage {
  const attached: string[] = [];
  const blocks: string[] = [];
  const pattern = /(^|\s)@([^\s]+)/g;

  let match = pattern.exec(text);
  while (match !== null) {
    const path = match[2];
    if (!attached.includes(path)) {
      const block = readAttachment(resolve(cwd, path));
      if (block !== null) {
        attached.push(path);
        blocks.push(`[attached file: ${path}]\n\`\`\`\n${block}\n\`\`\``);
      }
    }
    match = pattern.exec(text);
  }

  return {
    text: blocks.length > 0 ? `${text}\n\n${blocks.join('\n\n')}` : text,
    attached,
  };
}

function readAttachment(absolutePath: string): string | null {
  try {
    if (!statSync(absolutePath).isFile()) {
      return null;
    }
    const content = readFileSync(absolutePath, 'utf8');
    if (content.includes('\0')) {
      return null;
    }
    return content.length > MAX_ATTACH_CHARS
      ? `${content.slice(0, MAX_ATTACH_CHARS)}\n… [truncated, ${content.length} characters total]`
      : content;
  } catch {
    return null;
  }
}
