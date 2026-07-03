import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface UndoEntry {
  path: string;
  /** File content before the change; null means the file did not exist. */
  content: string | null;
}

const MAX_ENTRIES = 50;

/** In-memory snapshots of files taken before each write/edit, newest last. */
export class UndoStore {
  private readonly stack: UndoEntry[] = [];

  record(path: string, content: string | null): void {
    this.stack.push({ path, content });
    if (this.stack.length > MAX_ENTRIES) {
      this.stack.shift();
    }
  }

  /** Restores the most recent snapshot and returns it, or null when empty. */
  async undoLast(): Promise<UndoEntry | null> {
    const entry = this.stack.pop();
    if (entry === undefined) {
      return null;
    }
    if (entry.content === null) {
      await unlink(entry.path).catch((): void => {});
    } else {
      await mkdir(dirname(entry.path), { recursive: true });
      await writeFile(entry.path, entry.content, 'utf8');
    }
    return entry;
  }

  get size(): number {
    return this.stack.length;
  }
}
