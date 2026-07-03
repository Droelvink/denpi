const MAX_PREVIEW_LINES = 40;
const CONTEXT_LINES = 2;

/**
 * Minimal line diff for approval previews: trims the common prefix/suffix and
 * renders the changed middle as -/+ lines with a little context.
 */
export function diffLines(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--;
    endNew--;
  }

  const removed = oldLines.slice(start, endOld);
  const added = newLines.slice(start, endNew);
  if (removed.length === 0 && added.length === 0) {
    return '(no changes)';
  }

  const before = oldLines.slice(Math.max(0, start - CONTEXT_LINES), start).map((line) => `  ${line}`);
  const after = oldLines
    .slice(endOld, Math.min(oldLines.length, endOld + CONTEXT_LINES))
    .map((line) => `  ${line}`);

  return capLines(
    [
      `@@ line ${start + 1}`,
      ...before,
      ...removed.map((line) => `- ${line}`),
      ...added.map((line) => `+ ${line}`),
      ...after,
    ],
    MAX_PREVIEW_LINES,
  );
}

export function newFilePreview(content: string): string {
  const lines = content.split('\n');
  return capLines([`new file · ${lines.length} lines`, ...lines.map((line) => `+ ${line}`)], MAX_PREVIEW_LINES);
}

function capLines(lines: string[], max: number): string {
  if (lines.length <= max) {
    return lines.join('\n');
  }
  return [...lines.slice(0, max), `… (+${lines.length - max} more lines)`].join('\n');
}
