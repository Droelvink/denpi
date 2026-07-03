/**
 * denpi's visual identity: a calm, mostly-monochrome terminal with
 * electric-cyan "signal" accents and small wave glyphs for activity.
 */

export const colors = {
  accent: 'cyan',
  user: 'cyan',
  tool: 'yellow',
  dim: 'gray',
  error: 'red',
  ok: 'green',
} as const;

export const glyphs = {
  prompt: '›',
  assistant: '◆',
  tool: '▸',
  error: '✖',
  info: '·',
  bullet: '•',
} as const;

/** Frames for the animated signal wave shown while denpi is working. */
export const waveFrames: readonly string[] = buildWaveFrames();

function buildWaveFrames(): string[] {
  const ribbon = '▁▁▂▃▅▆▇█▇▆▅▃▂▁';
  const width = 5;
  const frames: string[] = [];
  for (let i = 0; i < ribbon.length; i++) {
    let frame = '';
    for (let j = 0; j < width; j++) {
      frame += ribbon[(i + j) % ribbon.length];
    }
    frames.push(frame);
  }
  return frames;
}
