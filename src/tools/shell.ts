import { spawn } from 'node:child_process';
import type { ToolContext, ToolDefinition } from './types.js';
import { requireString } from './types.js';

const IS_WINDOWS = process.platform === 'win32';
const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;

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
  requiresApproval: true,

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
