import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SETTINGS_DIR = join(homedir(), '.denpi');
const SETTINGS_PATH = join(SETTINGS_DIR, 'settings.json');

/** Settings that survive between denpi sessions (~/.denpi/settings.json). */
export interface PersistedSettings {
  model?: string;
}

export function loadSettings(): PersistedSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const settings: PersistedSettings = {};
    if (typeof record['model'] === 'string') {
      settings.model = record['model'];
    }
    return settings;
  } catch {
    return {};
  }
}

export function saveSettings(update: PersistedSettings): void {
  try {
    const merged: PersistedSettings = { ...loadSettings(), ...update };
    mkdirSync(SETTINGS_DIR, { recursive: true });
    writeFileSync(SETTINGS_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  } catch {
    // persistence is best-effort; never break the session over it
  }
}
