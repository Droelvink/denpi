import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SkillInfo {
  name: string;
  description: string;
  /** Absolute path to the skill's SKILL.md. */
  path: string;
}

/**
 * Discovers skills: folders containing a SKILL.md with optional YAML frontmatter
 * (name, description). Global skills live in ~/.denpi/skills/<name>/, workspace
 * skills in <cwd>/.denpi/skills/<name>/ — workspace wins on name collisions.
 */
export function discoverSkills(cwd: string): SkillInfo[] {
  const roots = [join(homedir(), '.denpi', 'skills'), join(cwd, '.denpi', 'skills')];
  const byName = new Map<string, SkillInfo>();
  for (const root of roots) {
    for (const skill of scanRoot(root)) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function scanRoot(root: string): SkillInfo[] {
  let directories: string[];
  try {
    directories = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const directory of directories) {
    const path = join(root, directory, 'SKILL.md');
    try {
      skills.push(parseSkill(directory, path, readFileSync(path, 'utf8')));
    } catch {
      // folder without a SKILL.md — not a skill
    }
  }
  return skills;
}

function parseSkill(directoryName: string, path: string, text: string): SkillInfo {
  const frontmatter = parseFrontmatter(text);
  return {
    name: frontmatter.get('name') ?? directoryName,
    description: frontmatter.get('description') ?? firstBodyLine(text),
    path,
  };
}

function parseFrontmatter(text: string): Map<string, string> {
  const values = new Map<string, string>();
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) {
    return values;
  }
  for (const line of match[1].split('\n')) {
    const pair = /^(\w[\w-]*):\s*(.+)$/.exec(line.trim());
    if (pair !== null) {
      values.set(pair[1], pair[2].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return values;
}

function firstBodyLine(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  for (const line of body.split('\n')) {
    const trimmed = line.replace(/^#+\s*/, '').trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return '';
}
