interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
}

const MAX_CAUSE_DEPTH = 5;

/**
 * Human-readable error description that follows the `cause` chain, so wrapped
 * errors (e.g. Node fetch's "TypeError: fetch failed" hiding an ENOTFOUND)
 * surface their actual reason.
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth++) {
    const described = describeOne(current);
    if (described.length > 0 && !parts.includes(described)) {
      parts.push(described);
    }
    current = typeof current === 'object' ? (current as ErrorLike).cause : undefined;
  }
  return parts.length > 0 ? parts.join(' ← ') : String(error);
}

function describeOne(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'object' || value === null) {
    return String(value);
  }
  const error = value as ErrorLike;
  const message = typeof error.message === 'string' && error.message.length > 0 ? error.message : String(value);
  const name = typeof error.name === 'string' && error.name !== 'Error' ? `${error.name}: ` : '';
  const code = typeof error.code === 'string' && !message.includes(error.code) ? ` (${error.code})` : '';
  return `${name}${message}${code}`;
}
