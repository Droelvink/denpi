import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolContext } from './types.js';

/**
 * Resolves a tool path against the workspace. When the sandbox is on (default),
 * paths that land outside the workspace are rejected.
 */
export function resolveWorkspacePath(context: ToolContext, path: string): string {
  const absolute = resolve(context.cwd, path);
  if (context.sandbox && !isInsideWorkspace(context.cwd, absolute)) {
    throw new Error(
      `path escapes the workspace: ${path} — the sandbox limits file access to ${context.cwd}. ` +
      'If the user really wants this, they must relaunch denpi with --no-sandbox.',
    );
  }
  return absolute;
}

export function isInsideWorkspace(cwd: string, absolutePath: string): boolean {
  const relativePath = relative(cwd, absolutePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

/** True when a tool path (relative or absolute) lands outside the workspace. */
export function leavesWorkspace(context: ToolContext, path: string): boolean {
  return !isInsideWorkspace(context.cwd, resolve(context.cwd, path));
}
