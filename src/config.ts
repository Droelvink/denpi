import { loadSettings } from './settings.js';

export interface DenpiConfig {
  /** Base URL of the OpenAI-compatible API, e.g. http://127.0.0.1:8080/v1 */
  baseUrl: string;
  /** Model name to request; llama-server serves whatever it loaded, so this is mostly cosmetic. */
  model: string;
  /** Skip approval prompts for shell / file-mutation tools. */
  autoApprove: boolean;
  /** When true (default), file tools may not leave the workspace. */
  sandbox: boolean;
  /** Extra text appended to the built-in system prompt. */
  extraSystemPrompt: string | null;
  /** Working directory tools operate in. */
  cwd: string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';

export function loadConfig(argv: string[]): DenpiConfig {
  const config: DenpiConfig = {
    baseUrl: process.env['DENPI_URL'] ?? DEFAULT_BASE_URL,
    model: process.env['DENPI_MODEL'] ?? loadSettings().model ?? 'default',
    autoApprove: false,
    sandbox: true,
    extraSystemPrompt: null,
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
      case '--auto':
        config.autoApprove = true;
        break;
      case '--no-sandbox':
        config.sandbox = false;
        break;
      default:
        throw new Error(`Unknown option: ${arg} (see denpi --help)`);
    }
  }

  config.baseUrl = config.baseUrl.replace(/\/+$/, '');
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
    --auto            auto-approve shell and file-mutation tools
    --no-sandbox      allow file tools to leave the workspace
    --help            show this help
    --version         show version

  environment
    DENPI_URL, DENPI_MODEL — defaults for --url / --model

  serve a model first, e.g.:
    llama-server -m model.gguf --jinja -ngl 99 -c 16384 --port 8080
`;

function expectValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) {
    throw new Error(`${flag} expects a value`);
  }
  return value;
}
