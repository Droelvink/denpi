import type { ToolDefinition } from './types.js';
import { requireString } from './types.js';

const TIMEOUT_MS = 20_000;
const MAX_LENGTH = 12_000;

export const fetchTool: ToolDefinition = {
  name: 'fetch',
  description: 'Fetch a URL over HTTP(S) and return its text content. HTML is reduced to readable text.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch (http or https).' },
    },
    required: ['url'],
  },

  needsApproval(): boolean {
    return false;
  },

  summarize(args: Record<string, unknown>): string {
    return typeof args['url'] === 'string' ? args['url'] : '(invalid url)';
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = requireString(args, 'url');
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('only http(s) URLs are supported');
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'clover/0.1', accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.8' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    const text = contentType.includes('html') ? htmlToText(body) : body;

    if (text.length > MAX_LENGTH) {
      return `${text.slice(0, MAX_LENGTH)}\n… [truncated, ${text.length} characters total]`;
    }
    return text;
  },
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}
