# ▂▃▅▇ denpi

A calm little terminal agent tuned to your local llama.cpp. Streams responses, calls tools
(shell, file read/write/edit, glob, grep, web fetch, web search), asks before doing anything mutating,
and can ask *you* clarifying questions (`ask_user`) when a task is ambiguous — answer
free-form, pick a suggested option with ↑/↓, or (when the model marks the question
multi-select) toggle several with space before sending.

## Requirements

- Node.js ≥ 18.17
- A recent [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` build
  (tool calls require `--jinja` and a chat template that supports tools — Qwen, Llama 3.x,
  Mistral, etc.)

## Setup

Serve a model on your GPU:

```
llama-server -m your-model.gguf --jinja -ngl 99 -c 16384 --port 8080
```

Then:

```
npm install
npm run build
npm start          # or: npm run dev (runs from source via tsx)
```

Optionally `npm link` to get a global `denpi` command.

## Usage

```
denpi [options]

--url <url>       OpenAI-compatible base URL (default: http://127.0.0.1:8080/v1)
--model <name>    model name to request (default: last /model choice, else "default")
--system <text>   extra instructions appended to the system prompt
--searxng <url>   SearXNG base URL for the web_search tool
```

Inside the session:

| input             | effect                                        |
| ----------------- | --------------------------------------------- |
| `/help`           | list commands and tools                       |
| `/model`          | list models the server offers                 |
| `/model <name|#>` | switch model (remembered across sessions)     |
| `/searxng [url|off]` | show/set the SearXNG URL for `web_search` (remembered), `off` disables |
| `/btw <question>` | quick side question, even while denpi is working — sees the whole conversation but uses no tools and leaves no trace in context |
| `/thought`        | keep thoughts in the transcript (`on`/`off`); `last` shows the most recent |
| `/skills`         | list available skills                         |
| `/permissions`    | show permission mode; `off` runs every tool call without asking (this session), `on` restores |
| `/stop`           | stop the running turn (also `esc` or `ctrl+c`) |
| `/undo`           | revert the last file change (repeatable)      |
| `@file`           | mention a workspace file to attach its content (autocompleted) |
| `/compact`        | instantly archive older messages out of context (deterministic, no model call); keeps the recent tail verbatim |
| `/clear`          | clear the chat and reset the context          |
| `/exit`           | leave denpi                                   |
| `esc` / `ctrl+c`  | stop the running turn (`ctrl+c` when idle: clear input, or exit if empty) |
| *typing while denpi works* | sends a message the model sees at its next step — steer without stopping |
| `tab` / `↑` `↓`   | autocomplete commands and their arguments     |
| `↑` `↓`           | browse input history (when no suggestions)    |
| `shift+enter`     | newline (also alt+enter, ctrl+j, trailing `\`)|

## Web search

The `web_search` tool talks to a [SearXNG](https://docs.searxng.org/) instance you point it
at — `/searxng <url>` in-session (persisted to `~/.denpi/settings.json`), or `--searxng <url>` /
`DENPI_SEARXNG` to override per launch. Pasting the search page URL is fine — a trailing
`/search` is stripped. The instance must allow the JSON API: its `settings.yml` needs
`json` listed under `search.formats`, and its bot-detection limiter must not block
non-browser clients — most public instances do (they answer HTTP 429), so a self-hosted
instance is the reliable choice. Until a URL is configured the tool reports itself as
unavailable. Searching returns titles, URLs and snippets; the model follows up with
`fetch` to read a result.

## Project instructions & skills

- **DENPI.md** — put one in the workspace root and its content is appended to the
  system prompt. Use it for project rules ("this repo uses X, never touch Y").
- **Skills** — folders with a `SKILL.md` playbook (YAML frontmatter: `name`,
  `description`). Global: `~/.denpi/skills/<name>/`, per-workspace:
  `.denpi/skills/<name>/` (workspace wins on collisions). denpi lists them in the
  system prompt; when a task matches, the model reads the playbook first.

Permissions are simple: tool calls that stay inside the workspace run without asking.
denpi prompts only when a call reaches outside the workspace (file paths, absolute
globs, shell commands referencing outside paths) or when a shell command is *flagged*
as destructive (`rm`/`del`/`Remove-Item`, `format`, `git reset --hard`, `git clean`,
force-push, shutdown, kill, …) — those always ask, even inside the workspace. File
changes show a colored diff preview in the prompt: **y** allow, **n** deny.
`/permissions off` bypasses every prompt for the rest of the session. Every write/edit
is snapshotted first, so `/undo` rolls changes back one at a time. Long-running shell
commands stream their last output lines live under the activity wave, and code blocks
in responses are syntax-highlighted.

File tools are sandboxed to the workspace (the directory denpi was started in):
paths outside it are rejected. Launch with `--no-sandbox` to lift this. The status
line shows `ctx` (tokens in context / context window) and generation speed after
each turn.

## Architecture

```
src/
  index.tsx          entry point / CLI flags
  config.ts          config from flags + env (DENPI_URL, DENPI_MODEL)
  theme.ts           colors, glyphs, the signal wave
  llm/               OpenAI-compatible streaming client (SSE, tool-call deltas)
  agent/             the agent loop: stream → execute tools → feed back → repeat
  tools/             one file per tool
  ui/                Ink components: transcript, markdown, activity wave, approval
```
