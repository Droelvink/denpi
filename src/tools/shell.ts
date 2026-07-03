import { spawn } from 'node:child_process';
import type { ToolContext, ToolDefinition } from './types.js';
import { requireString } from './types.js';
import { isInsideWorkspace } from './workspace.js';

const IS_WINDOWS = process.platform === 'win32';
const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Commands that can remove or break things always ask for approval,
 * even inside the workspace. Best-effort pattern match, not a sandbox.
 */
// Only matches in command position (start, or after ; | & ( { or sudo) so that
// arguments like "npm run format" don't trip it.
const COMMAND_START = /(?:^|[;|&({]\s*|\bsudo\s+)/.source;
const FLAGGED_PATTERNS: RegExp[] = [
  new RegExp(`${COMMAND_START}(rm|del|erase|rmdir|rd|remove-item|ri|unlink)\\b`, 'i'),
  new RegExp(`${COMMAND_START}(format|mkfs\\S*|diskpart|fdisk|dd)\\b`, 'i'),
  new RegExp(`${COMMAND_START}(shutdown|reboot|halt|poweroff|stop-computer|restart-computer)\\b`, 'i'),
  new RegExp(`${COMMAND_START}(taskkill|kill|pkill|killall|stop-process)\\b`, 'i'),
  /\breg(\.exe)?\s+delete\b/i,
  /\bgit\s+(reset\s+--hard|clean\b|checkout\s+--|restore\b|push\s+[^;|&]*(--force|-f)\b)/i,
];

export function isFlaggedCommand(command: string): boolean {
  return FLAGGED_PATTERNS.some((pattern) => pattern.test(command));
}

/** Best-effort scan for absolute paths in the command that point outside the workspace. */
export function referencesOutsidePath(command: string, cwd: string): boolean {
  const candidates = IS_WINDOWS
    ? (command.match(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`;|&)]*/g) ?? [])
    : (command.match(/(?:^|[\s"'=(])\/[^\s"'`;|&)]*/g) ?? []).map((match) => match.replace(/^[\s"'=(]/, ''));
  return candidates.some((path) => !isInsideWorkspace(cwd, path));
}

export const shellTool: ToolDefinition = {
  name: 'shell',
  description:
    `Run a shell command (${IS_WINDOWS ? 'PowerShell' : 'bash'}) in the working directory and return its output. ` +
    `Times out after ${TIMEOUT_MS / 1000}s.`,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute.' },
    },
    required: ['command'],
  },

  needsApproval(args: Record<string, unknown>, context: ToolContext): boolean {
    const command = typeof args['command'] === 'string' ? args['command'] : '';
    return isFlaggedCommand(command) || referencesOutsidePath(command, context.cwd);
  },

  summarize(args: Record<string, unknown>): string {
    return typeof args['command'] === 'string' ? args['command'] : '(invalid command)';
  },

  execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const command = requireString(args, 'command');
    return new Promise<string>((resolve) => {
      const child = IS_WINDOWS
        ? spawn('powershell.exe', ['-NoLogo', '-NonInteractive', '-Command', command], {
            cwd: context.cwd,
            windowsHide: true,
          })
        : spawn('/bin/bash', ['-c', command], { cwd: context.cwd });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let overflowed = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, TIMEOUT_MS);

      const onChunk = (chunk: Buffer, target: 'stdout' | 'stderr'): void => {
        if (target === 'stdout') {
          stdout += chunk.toString();
        } else {
          stderr += chunk.toString();
        }
        if (stdout.length + stderr.length > MAX_BUFFER && !overflowed) {
          overflowed = true;
          child.kill();
        }
        context.onProgress?.(progressTail(stdout + stderr));
      };
      child.stdout.on('data', (chunk: Buffer) => onChunk(chunk, 'stdout'));
      child.stderr.on('data', (chunk: Buffer) => onChunk(chunk, 'stderr'));

      child.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve(`Error: failed to start command — ${error.message}`);
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        const parts: string[] = [];
        if (stdout.length > 0) {
          parts.push(stdout.trimEnd());
        }
        if (stderr.length > 0) {
          parts.push(`[stderr]\n${stderr.trimEnd()}`);
        }
        if (timedOut) {
          parts.push(`[command timed out after ${TIMEOUT_MS / 1000}s]`);
        } else if (overflowed) {
          parts.push('[output exceeded 10MB — command killed]');
        } else if (code !== 0) {
          parts.push(`[exit code ${code ?? 'unknown'}]`);
        }
        resolve(parts.length > 0 ? parts.join('\n') : '(no output)');
      });
    });
  },
};

/** Last few non-empty lines, ANSI-stripped, for the live activity display. */
function progressTail(text: string): string {
  const clean = text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const lines = clean.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines
    .slice(-3)
    .map((line) => line.slice(0, 120))
    .join('\n');
}
