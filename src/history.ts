import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HISTORY_DIR = join(homedir(), '.clover');
const HISTORY_PATH = join(HISTORY_DIR, 'history');
const MAX_ENTRIES = 500;

/** Loads the last inputs from ~/.clover/history, oldest first. */
export function loadHistory(): string[] {
  try {
    const lines = readFileSync(HISTORY_PATH, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function appendHistory(entry: string): void {
  try {
    mkdirSync(HISTORY_DIR, { recursive: true });
    appendFileSync(HISTORY_PATH, `${entry.replace(/\r?\n/g, ' ')}\n`, 'utf8');
  } catch {
    // persistence is best-effort; never break the session over it
  }
}
