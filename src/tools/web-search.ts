import type { ToolContext, ToolDefinition } from './types.js';
import { optionalNumber, requireString } from './types.js';

const TIMEOUT_MS = 20_000;
const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 10;
const MAX_SNIPPET = 400;

interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web (via SearXNG) and return titles, URLs and snippets. ' +
    'Follow up with the fetch tool to read a promising result.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      max_results: {
        type: 'number',
        description: `How many results to return (1-${MAX_RESULTS}, default ${DEFAULT_RESULTS}).`,
      },
    },
    required: ['query'],
  },

  needsApproval(): boolean {
    return false;
  },

  summarize(args: Record<string, unknown>): string {
    return typeof args['query'] === 'string' ? args['query'] : '(invalid query)';
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const query = requireString(args, 'query');
    const limit = Math.min(MAX_RESULTS, Math.max(1, Math.floor(optionalNumber(args, 'max_results') ?? DEFAULT_RESULTS)));

    if (context.searxngUrl === null) {
      throw new Error(
        'web search is not configured — the user can point it at a SearXNG instance with /searxng <url> (or --searxng / DENPI_SEARXNG)',
      );
    }

    const url = `${context.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'denpi/0.1', accept: 'application/json' },
    });
    if (response.status === 403) {
      throw new Error(
        'the SearXNG instance rejected the JSON API (HTTP 403) — its settings.yml must list "json" under search.formats',
      );
    }
    if (response.status === 429) {
      throw new Error(
        'the SearXNG instance rate-limited the request (HTTP 429) — most public instances block non-browser ' +
          'clients via bot detection; use a self-hosted instance or one that allows the JSON API',
      );
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      throw new Error(
        'the SearXNG instance answered with an HTML page instead of JSON — likely a bot-protection challenge; ' +
          'use a self-hosted instance or one that allows the JSON API',
      );
    }

    const data = (await response.json()) as { results?: SearxResult[]; answers?: unknown[] };
    const results = (data.results ?? []).filter((result) => typeof result.url === 'string').slice(0, limit);
    const lines: string[] = [];

    for (const answer of data.answers ?? []) {
      const text = typeof answer === 'string' ? answer : (answer as { answer?: string }).answer;
      if (typeof text === 'string' && text.length > 0) {
        lines.push(`answer: ${text}`);
      }
    }

    if (results.length === 0) {
      lines.push(`no results for "${query}"`);
      return lines.join('\n');
    }

    results.forEach((result, index) => {
      const snippet = (result.content ?? '').replace(/\s+/g, ' ').trim();
      lines.push(`${index + 1}. ${result.title ?? '(untitled)'}`);
      lines.push(`   ${result.url}`);
      if (snippet.length > 0) {
        lines.push(`   ${snippet.length > MAX_SNIPPET ? `${snippet.slice(0, MAX_SNIPPET)}…` : snippet}`);
      }
    });
    return lines.join('\n');
  },
};
