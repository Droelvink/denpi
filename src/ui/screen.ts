/**
 * Wipes the screen and scrollback, then parks the cursor on the last row so
 * the UI renders at the bottom of the terminal and content grows upward.
 */
export function resetScreen(): void {
  const rows = process.stdout.rows ?? 24;
  process.stdout.write(`\x1b[2J\x1b[3J\x1b[H${'\n'.repeat(Math.max(0, rows - 1))}`);
}
