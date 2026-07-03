import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DenpiConfig } from '../config.js';
import type { SkillInfo } from '../skills.js';
import { discoverSkills } from '../skills.js';

const MAX_INSTRUCTIONS_CHARS = 16_000;

/** Reads DENPI.md from the workspace root, or null when there is none. */
export function loadProjectInstructions(cwd: string): string | null {
  try {
    const text = readFileSync(join(cwd, 'DENPI.md'), 'utf8').trim();
    if (text.length === 0) {
      return null;
    }
    return text.length > MAX_INSTRUCTIONS_CHARS ? text.slice(0, MAX_INSTRUCTIONS_CHARS) : text;
  } catch {
    return null;
  }
}

export function buildSystemPrompt(config: DenpiConfig): string {
  const shell = process.platform === 'win32' ? 'PowerShell' : 'bash';
  const base = `You are denpi, a capable and concise agent running in the user's terminal.

Your workspace is the directory denpi was started in:
  ${config.cwd}

The workspace is your default context for everything:
- Relative paths in every tool resolve against the workspace; prefer relative paths.
- When the user names a file or folder without a full path, assume it lives in the workspace — locate it with glob or grep instead of asking.
- Shell commands run from the workspace.
${config.sandbox
    ? '- The sandbox is on: file tools reject any path outside the workspace. Keep shell commands inside it too.'
    : '- Do not read or modify anything outside the workspace unless the user explicitly points you there.'}

Environment:
- platform: ${process.platform}
- shell for the shell tool: ${shell}
- date: ${new Date().toDateString()}

Guidelines:
- Use your tools proactively to inspect files and run commands instead of guessing.
- Prefer edit_file for small changes; use write_file only for new files or full rewrites.
- Read a file before editing it.
- Keep responses brief and to the point; this is a terminal, not a blog.
- When requirements are ambiguous or a choice meaningfully affects the result, ask with the ask_user tool instead of guessing.
- When a task is done, summarize what changed in a sentence or two.`;

  const sections: string[] = [base];

  const skills = discoverSkills(config.cwd);
  if (skills.length > 0) {
    sections.push(skillsSection(skills));
  }

  const instructions = loadProjectInstructions(config.cwd);
  if (instructions !== null) {
    sections.push(`Project instructions (from DENPI.md in the workspace — follow these):\n\n${instructions}`);
  }

  if (config.extraSystemPrompt !== null) {
    sections.push(config.extraSystemPrompt);
  }
  return sections.join('\n\n');
}

function skillsSection(skills: SkillInfo[]): string {
  const list = skills.map((skill) => `- ${skill.name}: ${skill.description}\n  playbook: ${skill.path}`).join('\n');
  return `Skills:
The following skills are available. Each is a folder of expertise with a SKILL.md playbook.
When a task matches a skill's description, read its SKILL.md with read_file BEFORE doing the task, then follow it.
Files a skill references live in that skill's folder.

${list}`;
}
