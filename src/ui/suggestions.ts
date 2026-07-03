import { shortModelName } from '../llm/client.js';

export interface Suggestion {
  /** Full input text this suggestion completes to. */
  value: string;
  label: string;
  hint?: string;
}

interface CommandSpec {
  name: string;
  hint: string;
  takesArgument: boolean;
}

const COMMANDS: CommandSpec[] = [
  { name: '/help', hint: 'show commands', takesArgument: false },
  { name: '/model', hint: 'list or switch models', takesArgument: true },
  { name: '/thought', hint: 'show or hide the thinking stream', takesArgument: true },
  { name: '/skills', hint: 'list available skills', takesArgument: false },
  { name: '/permissions', hint: 'show permission mode · off = run everything without asking', takesArgument: true },
  { name: '/undo', hint: 'revert the last file change', takesArgument: false },
  { name: '/compact', hint: 'archive older messages · instant, no model call', takesArgument: false },
  { name: '/clear', hint: 'clear the chat and reset the context', takesArgument: false },
  { name: '/exit', hint: 'leave denpi', takesArgument: false },
];

const MAX_FILE_SUGGESTIONS = 25;

/**
 * Completions for the current input: command names after a leading "/",
 * argument values for commands that take one, and workspace file paths
 * after an "@" mention.
 */
export function getSuggestions(input: string, models: string[], files: string[]): Suggestion[] {
  const mention = /(^|\s)@([^\s]*)$/.exec(input);
  if (mention !== null) {
    const token = mention[2].toLowerCase();
    const prefix = input.slice(0, input.length - mention[2].length);
    return files
      .filter((file) => file.toLowerCase().includes(token) && file !== mention[2])
      .slice(0, MAX_FILE_SUGGESTIONS)
      .map((file) => ({ value: `${prefix}${file}`, label: file }));
  }

  if (!input.startsWith('/')) {
    return [];
  }

  const spaceIndex = input.indexOf(' ');
  if (spaceIndex === -1) {
    return COMMANDS.filter((command) => command.name.startsWith(input) && command.name !== input).map(
      (command) => ({
        value: command.takesArgument ? `${command.name} ` : command.name,
        label: command.name,
        hint: command.hint,
      }),
    );
  }

  const command = input.slice(0, spaceIndex);
  const argument = input.slice(spaceIndex + 1);

  if (command === '/model') {
    return models
      .filter((id) => id.toLowerCase().includes(argument.toLowerCase()) && id !== argument)
      .map((id) => {
        const label = shortModelName(id);
        return { value: `/model ${id}`, label, hint: label === id ? undefined : id };
      });
  }
  if (command === '/thought') {
    return ['on', 'off', 'last']
      .filter((option) => option.startsWith(argument) && option !== argument)
      .map((option) => ({ value: `/thought ${option}`, label: option }));
  }
  if (command === '/permissions') {
    return ['off', 'on']
      .filter((option) => option.startsWith(argument) && option !== argument)
      .map((option) => ({ value: `/permissions ${option}`, label: option }));
  }
  return [];
}
