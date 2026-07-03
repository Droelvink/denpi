import { loadSettings } from './settings.js';

export interface DenpiConfig {
  /** Base URL of the OpenAI-compatible API, e.g. http://127.0.0.1:8080/v1 */
  baseUrl: string;
  /** Model name to request; llama-server serves whatever it loaded, so this is mostly cosmetic. */
  model: string;
  /** When true (default), file tools may not leave the workspace. */
  sandbox: boolean;
  /** Extra text appended to the built-in system prompt. */
  extraSystemPrompt: string | null;
  /** Base URL of a SearXNG instance for the web_search tool, or null when unconfigured. */
  searxngUrl: string | null;
  /** Working directory tools operate in. */
  cwd: string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';

export function loadConfig(argv: string[]): DenpiConfig {
  const settings = loadSettings();
  const config: DenpiConfig = {
    baseUrl: process.env['DENPI_URL'] ?? DEFAULT_BASE_URL,
    model: process.env['DENPI_MODEL'] ?? settings.model ?? 'default',
    sandbox: true,
    extraSystemPrompt: null,
    searxngUrl: process.env['DENPI_SEARXNG'] ?? settings.searxngUrl ?? null,
    cwd: process.cwd(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--url':
        config.baseUrl = expectValue(argv, ++i, '--url');
        break;
      case '--model':
        config.model = expectValue(argv, ++i, '--model');
        break;
      case '--system':
        config.extraSystemPrompt = expectValue(argv, ++i, '--system');
        break;
      case '--no-sandbox':
        config.sandbox = false;
        break;
      case '--searxng': {
        const value = normalizeSearxngUrl(expectValue(argv, ++i, '--searxng'));
        if (value === null) {
          throw new Error('--searxng expects an http(s) URL');
        }
        config.searxngUrl = value;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg} (see denpi --help)`);
    }
  }

  config.baseUrl = config.baseUrl.replace(/\/+$/, '');
  config.searxngUrl = normalizeSearxngUrl(config.searxngUrl);
  return config;
}

export const usage: string = `
  ▂▃▅▇ denpi — a calm little terminal agent tuned to llama.cpp

  usage
    denpi [options]

  options
    --url <url>       OpenAI-compatible base URL (default: ${DEFAULT_BASE_URL})
    --model <name>    model name to request (default: "default")
    --system <text>   extra instructions appended to the system prompt
    --searxng <url>   SearXNG base URL for the web_search tool (also /searxng in-session)
    --no-sandbox      allow file tools to leave the workspace
    --help            show this help
    --version         show version

  environment
    DENPI_URL, DENPI_MODEL, DENPI_SEARXNG — defaults for --url / --model / --searxng

  serve a model first, e.g.:
    llama-server -m model.gguf --jinja -ngl 99 -c 16384 --port 8080
`;

/**
 * Trims trailing slashes and a trailing /search path (people paste the search
 * page URL — the tool appends /search itself); rejects non-http(s) values.
 * Null when unset or invalid.
 */
export function normalizeSearxngUrl(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  const trimmed = url
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\/search$/i, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function expectValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) {
    throw new Error(`${flag} expects a value`);
  }
  return value;
}
