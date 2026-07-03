/**
 * clover's visual identity: a calm, mostly-monochrome terminal with soft
 * pastel-green accents and a small braille spinner for activity.
 */

export const colors = {
  accent: '#8fe0a8',
  user: '#8fe0a8',
  tool: 'yellow',
  dim: 'gray',
  error: 'red',
  ok: 'green',
} as const;

/** Brand mark shown in the banner and usage header. */
export const brand = '☘';

export const glyphs = {
  prompt: '›',
  assistant: '◆',
  tool: '▸',
  error: '✖',
  info: '·',
  bullet: '•',
} as const;

/** Frames for the calm spinner shown while clover is working. */
export const spinnerFrames: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
