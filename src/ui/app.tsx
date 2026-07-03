import { homedir } from 'node:os';
import fg from 'fast-glob';
import { Box, Static, Text, useApp, useInput } from 'ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Agent } from '../agent/agent.js';
import type { AgentEvent, ApprovalDecision, ToolCallInfo } from '../agent/events.js';
import type { CloverConfig } from '../config.js';
import { normalizeSearxngUrl } from '../config.js';
import { loadProjectInstructions } from '../agent/system-prompt.js';
import { appendHistory, loadHistory } from '../history.js';
import { describeError } from '../errors.js';
import { fetchContextSize, fetchModelIds, shortModelName } from '../llm/client.js';
import { saveSettings } from '../settings.js';
import { discoverSkills } from '../skills.js';
import { allTools } from '../tools/registry.js';
import { colors, glyphs } from '../theme.js';
import { Activity } from './activity.js';
import type { ApprovalRequest } from './approval.js';
import { ApprovalPrompt } from './approval.js';
import { expandMentions } from './mentions.js';
import { MultilineInput } from './multiline-input.js';
import type { QuestionRequest } from './question.js';
import { QuestionPrompt } from './question.js';
import { resetScreen } from './screen.js';
import { getSuggestions } from './suggestions.js';
import type { TranscriptItem } from './transcript.js';
import { TranscriptLine } from './transcript.js';

const HELP_LINES: readonly string[] = [
  '/help   show this help',
  '/model  list models the server offers · /model <name|#> to switch',
  '/btw <q>  quick side question, even mid-turn — sees the conversation, no tools, leaves no trace in context',
  '/searxng  show the SearXNG URL for web_search · /searxng <url> sets it (remembered), /searxng off disables',
  '/thought  keep thoughts in the transcript · /thought on|off|last',
  '/skills list available skills (.clover/skills/<name>/SKILL.md)',
  '/permissions  show permission mode · /permissions off runs everything without asking (this session)',
  '/stop   stop the running turn (also esc or ctrl+c)',
  '/undo   revert the last file change made by write_file/edit_file',
  '/compact  instantly archive older messages (no model call), keep the recent tail',
  '/clear  clear the chat and reset the conversation context',
  '/exit   leave clover',
  'tab     autocomplete commands and arguments (↑/↓ to choose)',
  '@file   mention a workspace file to attach its content (autocompleted)',
  '↑/↓     browse input history (when no suggestion list is open)',
  'newline shift+enter, alt+enter, ctrl+j, or end a line with \\ — pasting keeps newlines',
  'esc     stop a running turn (also ctrl+c or /stop) — typing while clover works steers it mid-turn',
  `tools   ${allTools.map((tool) => tool.name).join(', ')}`,
];

const REASONING_TAIL = 240;
const MAX_VISIBLE_SUGGESTIONS = 5;
const FILE_SCAN_TTL_MS = 5000;

export function App({ config }: { config: CloverConfig }): React.JSX.Element {
  const { exit } = useApp();
  const skills = useMemo(() => discoverSkills(config.cwd), [config.cwd]);
  const history = useMemo<string[]>(() => loadHistory(), []);
  const [items, setItems] = useState<TranscriptItem[]>(() => initialItems(config, skills));
  const [transcriptKey, setTranscriptKey] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [reasoningText, setReasoningText] = useState('');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [question, setQuestion] = useState<QuestionRequest | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState(config.model);
  const [thoughtsEnabled, setThoughtsEnabled] = useState(true);
  const [searxngUrl, setSearxngUrl] = useState(config.searxngUrl);
  const [permissionsOff, setPermissionsOff] = useState(false);
  const thoughtsEnabledRef = useRef(true);
  /** A /btw side question runs independently of the main turn, with its own abort. */
  const [sideBusy, setSideBusy] = useState(false);
  const [sideStreamText, setSideStreamText] = useState('');
  const sideAbortRef = useRef<AbortController | null>(null);
  const lastThoughtRef = useRef<{ text: string; durationMs: number } | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef('');
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const fileScanRef = useRef({ lastScanAt: 0, running: false });

  useEffect(() => {
    const scan = fileScanRef.current;
    if (!input.includes('@') || scan.running || Date.now() - scan.lastScanAt < FILE_SCAN_TTL_MS) {
      return;
    }
    scan.running = true;
    void fg('**/*', {
      cwd: config.cwd,
      dot: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      suppressErrors: true,
      followSymbolicLinks: false,
    })
      .then((found) => setWorkspaceFiles(found.sort().slice(0, 5000)))
      .catch((): void => {})
      .finally(() => {
        scan.lastScanAt = Date.now();
        scan.running = false;
      });
  }, [config.cwd, input]);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [tokenStats, setTokenStats] = useState<{ contextTokens: number; tokensPerSecond: number | null } | null>(null);
  const [contextSize, setContextSize] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pushItem = useCallback((item: TranscriptItem): void => {
    setItems((previous) => [...previous, item]);
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetchModelIds(config.baseUrl).then((ids) => {
      if (mounted) {
        setModels(ids);
        setServerStatus(ids.length > 0 ? 'online' : 'offline');
      }
    });
    void fetchContextSize(config.baseUrl).then((size) => {
      if (mounted) {
        setContextSize(size);
      }
    });
    return (): void => {
      mounted = false;
    };
  }, [config.baseUrl]);

  const suggestions = useMemo(
    () => (busy ? [] : getSuggestions(input, models, workspaceFiles)),
    [busy, input, models, workspaceFiles],
  );

  useEffect(() => {
    setSuggestionIndex(0);
  }, [input]);

  const recallHistory = useCallback(
    (direction: -1 | 1): void => {
      if (history.length === 0) {
        return;
      }
      if (historyIndex === null) {
        if (direction === 1) {
          return;
        }
        draftRef.current = input;
        setHistoryIndex(history.length - 1);
        setInput(history[history.length - 1]);
        return;
      }
      const next = historyIndex + direction;
      if (next < 0) {
        return;
      }
      if (next >= history.length) {
        setHistoryIndex(null);
        setInput(draftRef.current);
        return;
      }
      setHistoryIndex(next);
      setInput(history[next]);
    },
    [history, historyIndex, input],
  );

  const acceptSuggestion = useCallback((): void => {
    const selected = suggestions[Math.min(suggestionIndex, suggestions.length - 1)];
    if (selected !== undefined) {
      setInput(selected.value);
    }
  }, [suggestionIndex, suggestions]);

  const handleEvent = useCallback(
    (event: AgentEvent): void => {
      switch (event.type) {
        case 'assistant-delta':
          setStreamText((previous) => previous + event.text);
          break;
        case 'assistant-done':
          setStreamText('');
          pushItem({ kind: 'assistant', text: event.text });
          break;
        case 'reasoning-delta':
          setReasoningText((previous) => previous + event.text);
          break;
        case 'reasoning-done':
          setReasoningText('');
          lastThoughtRef.current = { text: event.text, durationMs: event.durationMs };
          if (thoughtsEnabledRef.current) {
            pushItem({ kind: 'thought', text: event.text, durationMs: event.durationMs });
          } else {
            pushItem({
              kind: 'info',
              text: `thought for ${(event.durationMs / 1000).toFixed(1)}s · /thought last to view`,
            });
          }
          break;
        case 'tool-start':
          setActiveTool(`${event.call.name} · ${event.call.summary}`.slice(0, 80));
          setToolProgress(null);
          break;
        case 'tool-progress':
          setToolProgress(event.text.length > 0 ? event.text : null);
          break;
        case 'tool-done':
          setActiveTool(null);
          setToolProgress(null);
          pushItem({
            kind: 'tool',
            name: event.call.name,
            summary: event.call.summary,
            output: event.output,
            isError: event.isError,
            durationMs: event.durationMs,
          });
          break;
        case 'tool-denied':
          pushItem({ kind: 'tool-denied', name: event.call.name, summary: event.call.summary });
          break;
        case 'usage':
          setTokenStats({
            contextTokens: event.promptTokens + event.completionTokens,
            tokensPerSecond: event.tokensPerSecond,
          });
          break;
        case 'notice':
          pushItem({ kind: 'info', text: event.text });
          break;
        case 'cancelled':
          pushItem({ kind: 'info', text: 'cancelled' });
          break;
        case 'error':
          pushItem({ kind: 'error', text: event.message });
          break;
      }
    },
    [pushItem],
  );

  const agent = useMemo(
    () =>
      new Agent({
        config,
        tools: allTools,
        requestApproval: (call: ToolCallInfo, preview: string | null): Promise<ApprovalDecision> =>
          new Promise<ApprovalDecision>((resolve) => {
            setApproval({
              call,
              preview,
              resolve: (decision: ApprovalDecision): void => {
                setApproval(null);
                resolve(decision);
              },
            });
          }),
        requestQuestion: (questionText: string, options: string[], multiSelect: boolean): Promise<string> =>
          new Promise<string>((resolve) => {
            setQuestion({
              question: questionText,
              options,
              multiSelect,
              resolve: (answer: string): void => {
                setQuestion(null);
                resolve(answer);
              },
            });
          }),
      }),
    [config],
  );

  const runTurn = useCallback(
    (text: string): void => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      void agent.run(text, handleEvent, controller.signal).finally(() => {
        setBusy(false);
        setStreamText('');
        setReasoningText('');
        setActiveTool(null);
        setToolProgress(null);
        setQuestion(null);
        abortRef.current = null;
      });
    },
    [agent, handleEvent],
  );

  const runSideQuestion = useCallback(
    (question: string): void => {
      const controller = new AbortController();
      sideAbortRef.current = controller;
      setSideBusy(true);
      pushItem({ kind: 'info', text: `btw: ${question}` });
      void agent
        .sideQuestion(
          question,
          (delta: string): void => setSideStreamText((previous) => previous + delta),
          (): void => {}, // side reasoning is not shown — it would interleave with the main turn's
          controller.signal,
        )
        .then((answer: string): void => {
          pushItem({ kind: 'btw', text: answer.length > 0 ? answer : '(no answer)' });
        })
        .catch((error: unknown): void => {
          if (controller.signal.aborted) {
            pushItem({ kind: 'info', text: 'side question cancelled' });
          } else {
            pushItem({ kind: 'error', text: describeError(error) });
          }
        })
        .finally((): void => {
          setSideBusy(false);
          setSideStreamText('');
          sideAbortRef.current = null;
        });
    },
    [agent, pushItem],
  );

  /** Aborts the main turn and/or a running side question; false when nothing was running. */
  const stopEverything = useCallback((): boolean => {
    let stopped = false;
    if (abortRef.current !== null) {
      abortRef.current.abort();
      stopped = true;
    }
    if (sideAbortRef.current !== null) {
      sideAbortRef.current.abort();
      stopped = true;
    }
    return stopped;
  }, []);

  const switchModel = useCallback(
    (id: string): void => {
      agent.setModel(id);
      setCurrentModel(id);
      saveSettings({ model: id });
      pushItem({ kind: 'info', text: `tuned to ${shortModelName(id)} · remembered for next time` });
    },
    [agent, pushItem],
  );

  const handleModelCommand = useCallback(
    (argument: string): void => {
      if (argument.length === 0) {
        void fetchModelIds(config.baseUrl).then((ids) => {
          setModels(ids);
          setServerStatus(ids.length > 0 ? 'online' : 'offline');
          if (ids.length === 0) {
            pushItem({ kind: 'error', text: `no models reported at ${config.baseUrl}` });
            return;
          }
          ids.forEach((id, index) => {
            const isCurrent =
              id === currentModel ||
              shortModelName(id) === shortModelName(currentModel) ||
              (currentModel === 'default' && index === 0);
            pushItem({ kind: 'info', text: `${isCurrent ? '▸' : ' '} ${index + 1}. ${id}` });
          });
          pushItem({ kind: 'info', text: 'switch with /model <name|#>' });
        });
        return;
      }
      if (/^\d+$/.test(argument)) {
        const index = Number(argument) - 1;
        if (index < 0 || index >= models.length) {
          pushItem({ kind: 'error', text: `no model #${argument} — run /model to list them first` });
          return;
        }
        switchModel(models[index]);
        return;
      }
      switchModel(argument);
    },
    [config.baseUrl, currentModel, models, pushItem, switchModel],
  );

  const handleSubmit = useCallback(
    (raw: string): void => {
      if (suggestions.length > 0) {
        acceptSuggestion();
        return;
      }
      const text = raw.trim();
      setInput('');
      setHistoryIndex(null);
      if (text.length === 0) {
        return;
      }
      if (history[history.length - 1] !== text) {
        history.push(text);
        appendHistory(text);
      }
      if (text === '/stop') {
        if (!stopEverything()) {
          pushItem({ kind: 'info', text: 'nothing is running' });
        }
        return;
      }
      if (text === '/btw' || text.startsWith('/btw ')) {
        const question = text.slice('/btw'.length).trim();
        if (question.length === 0) {
          pushItem({ kind: 'error', text: 'usage: /btw <question>' });
          return;
        }
        if (sideBusy) {
          pushItem({ kind: 'error', text: 'a side question is already running — /stop cancels it' });
          return;
        }
        runSideQuestion(question);
        return;
      }
      if (busy) {
        // A message typed mid-turn: show it and weave it into the running conversation.
        if (text.startsWith('/')) {
          pushItem({ kind: 'error', text: 'commands are unavailable while clover is working — /stop to interrupt' });
          return;
        }
        pushItem({ kind: 'user', text });
        const expanded = expandMentions(text, config.cwd);
        if (expanded.attached.length > 0) {
          pushItem({ kind: 'info', text: `attached: ${expanded.attached.join(', ')}` });
        }
        agent.inject(expanded.text);
        return;
      }
      if (text === '/exit' || text === '/quit') {
        exit();
        return;
      }
      if (text === '/help') {
        for (const line of HELP_LINES) {
          pushItem({ kind: 'info', text: line });
        }
        return;
      }
      if (text === '/model' || text.startsWith('/model ')) {
        handleModelCommand(text.slice('/model'.length).trim());
        return;
      }
      if (text === '/searxng' || text.startsWith('/searxng ')) {
        const argument = text.slice('/searxng'.length).trim();
        if (argument === '') {
          pushItem({
            kind: 'info',
            text:
              searxngUrl === null
                ? 'web search off — /searxng <url> points it at a SearXNG instance (its settings.yml must allow the json format)'
                : `web search via ${searxngUrl} · /searxng <url> to change, /searxng off to disable`,
          });
          return;
        }
        if (argument === 'off') {
          agent.setSearxngUrl(null);
          setSearxngUrl(null);
          saveSettings({ searxngUrl: undefined });
          pushItem({ kind: 'info', text: 'web search off' });
          return;
        }
        const normalized = normalizeSearxngUrl(argument);
        if (normalized === null) {
          pushItem({ kind: 'error', text: 'usage: /searxng <http(s) url> · /searxng off' });
          return;
        }
        agent.setSearxngUrl(normalized);
        setSearxngUrl(normalized);
        saveSettings({ searxngUrl: normalized });
        pushItem({ kind: 'info', text: `web search via ${normalized} · remembered for next time` });
        return;
      }
      if (text === '/thought' || text.startsWith('/thought ')) {
        const argument = text.slice('/thought'.length).trim();
        if (argument === 'last') {
          const last = lastThoughtRef.current;
          if (last === null) {
            pushItem({ kind: 'info', text: 'no thoughts recorded yet' });
          } else {
            pushItem({ kind: 'thought', text: last.text, durationMs: last.durationMs });
          }
          return;
        }
        if (argument !== '' && argument !== 'on' && argument !== 'off') {
          pushItem({ kind: 'error', text: 'usage: /thought [on|off|last]' });
          return;
        }
        const enabled = argument === '' ? !thoughtsEnabled : argument === 'on';
        setThoughtsEnabled(enabled);
        thoughtsEnabledRef.current = enabled;
        pushItem({
          kind: 'info',
          text: enabled ? 'thoughts shown in the transcript' : 'thoughts hidden · /thought last shows the most recent',
        });
        return;
      }
      if (text === '/skills') {
        if (skills.length === 0) {
          pushItem({ kind: 'info', text: 'no skills found — add .clover/skills/<name>/SKILL.md here or in your home directory' });
        } else {
          for (const skill of skills) {
            pushItem({ kind: 'info', text: `${skill.name} — ${skill.description}` });
          }
        }
        return;
      }
      if (text === '/permissions' || text.startsWith('/permissions ')) {
        const argument = text.slice('/permissions'.length).trim();
        if (argument === 'off') {
          agent.setPermissionsBypassed(true);
          setPermissionsOff(true);
          pushItem({ kind: 'info', text: 'permissions off — every tool call runs without asking (this session only)' });
        } else if (argument === 'on') {
          agent.setPermissionsBypassed(false);
          setPermissionsOff(false);
          pushItem({ kind: 'info', text: 'permissions on — asks outside the workspace and for flagged commands' });
        } else if (argument === '') {
          pushItem({
            kind: 'info',
            text: permissionsOff
              ? 'permissions off — every tool call runs without asking · /permissions on to restore'
              : 'permissions on — workspace calls run freely; asks outside the workspace and for flagged (destructive) commands · /permissions off to bypass',
          });
        } else {
          pushItem({ kind: 'error', text: 'usage: /permissions [on|off]' });
        }
        return;
      }
      if (text === '/undo') {
        void agent.undo.undoLast().then((entry) => {
          if (entry === null) {
            pushItem({ kind: 'info', text: 'nothing to undo' });
          } else {
            const action = entry.content === null ? 'deleted (file was newly created)' : 'restored';
            pushItem({
              kind: 'info',
              text: `${action}: ${entry.path} · ${agent.undo.size} more undo step(s) — note: the model is not told about undos`,
            });
          }
        });
        return;
      }
      if (text === '/compact') {
        const result = agent.compact(contextSize);
        if (result === null) {
          pushItem({ kind: 'info', text: 'nothing to compact — the conversation already fits comfortably' });
        } else {
          pushItem({
            kind: 'info',
            text: `── compacted · ${result.folded} messages archived · last ${result.kept} kept verbatim ──`,
          });
          setTokenStats(null);
        }
        return;
      }
      if (text === '/clear') {
        agent.reset();
        lastThoughtRef.current = null;
        setTokenStats(null);
        // wipe screen + scrollback, then remount the transcript with a fresh banner
        resetScreen();
        setItems(initialItems(config, skills));
        setTranscriptKey((key) => key + 1);
        return;
      }
      if (text.startsWith('/')) {
        pushItem({ kind: 'error', text: `unknown command: ${text}` });
        return;
      }
      pushItem({ kind: 'user', text });
      const expanded = expandMentions(text, config.cwd);
      if (expanded.attached.length > 0) {
        pushItem({ kind: 'info', text: `attached: ${expanded.attached.join(', ')}` });
      }
      runTurn(expanded.text);
    },
    [acceptSuggestion, agent, busy, config, contextSize, exit, handleModelCommand, history, permissionsOff, pushItem, runSideQuestion, runTurn, searxngUrl, sideBusy, skills, stopEverything, suggestions, thoughtsEnabled],
  );

  const displayModel =
    currentModel !== 'default'
      ? shortModelName(currentModel)
      : models.length > 0
        ? shortModelName(models[0])
        : 'default';

  useInput((char, key) => {
    const promptOpen = approval !== null || question !== null;
    if (key.ctrl && char === 'c') {
      if (promptOpen) {
        return; // an approval/question prompt is open — answer it instead
      }
      if (stopEverything()) {
        return;
      }
      if (input.length > 0) {
        setInput('');
        setHistoryIndex(null);
        return;
      }
      exit();
      return;
    }
    if (key.escape && !promptOpen) {
      stopEverything();
    }
  });

  const suggestionWindowStart = Math.min(
    Math.max(0, suggestionIndex - 2),
    Math.max(0, suggestions.length - MAX_VISIBLE_SUGGESTIONS),
  );
  const visibleSuggestions = suggestions.slice(
    suggestionWindowStart,
    suggestionWindowStart + MAX_VISIBLE_SUGGESTIONS,
  );

  return (
    <Box flexDirection="column">
      <Static key={`transcript-${transcriptKey}`} items={items}>
        {(item, index) => <TranscriptLine key={index} item={item} />}
      </Static>

      {thoughtsEnabled && reasoningText.length > 0 && (
        <Box marginTop={1}>
          <Text color={colors.dim} italic>
            {tail(reasoningText)}
          </Text>
        </Box>
      )}

      {streamText.length > 0 && (
        <Box marginTop={1}>
          <Text color={colors.accent}>{glyphs.assistant} </Text>
          <Text>{streamText}</Text>
        </Box>
      )}

      {sideBusy && (
        <Box marginTop={1}>
          <Text color={colors.dim}>{glyphs.info} btw · </Text>
          <Text color={colors.dim} italic>
            {sideStreamText.length > 0 ? tail(sideStreamText) : 'thinking…'}
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {approval !== null ? (
          <ApprovalPrompt request={approval} />
        ) : question !== null ? (
          <QuestionPrompt request={question} />
        ) : (
          <Box flexDirection="column">
            {busy && (
              <Box flexDirection="column">
                <Activity label={activeTool ?? 'thinking'} />
                {toolProgress !== null &&
                  toolProgress.split('\n').map((line, index) => (
                    <Text key={index} color={colors.dim}>
                      {'  '}
                      {line}
                    </Text>
                  ))}
              </Box>
            )}
            <MultilineInput
              value={input}
              onChange={(value: string): void => {
                setInput(value);
                setHistoryIndex(null);
              }}
              onSubmit={handleSubmit}
              placeholder={busy ? 'type to steer clover · /stop, esc or ctrl+c to stop' : 'ask clover anything'}
              suggestionsOpen={suggestions.length > 0}
              onSuggestionTab={acceptSuggestion}
              onSuggestionUp={(): void =>
                setSuggestionIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
              }
              onSuggestionDown={(): void => setSuggestionIndex((index) => (index + 1) % suggestions.length)}
              onHistoryUp={(): void => recallHistory(-1)}
              onHistoryDown={(): void => recallHistory(1)}
            />
          </Box>
        )}
        {!busy && approval === null && visibleSuggestions.length > 0 && (
          <Box flexDirection="column">
            {visibleSuggestions.map((suggestion, offset) => {
              const isSelected = suggestionWindowStart + offset === suggestionIndex;
              return (
                <Text key={suggestion.value}>
                  <Text color={colors.accent}>{isSelected ? '▸ ' : '  '}</Text>
                  <Text color={isSelected ? colors.accent : colors.dim}>{suggestion.label}</Text>
                  {suggestion.hint !== undefined && <Text color={colors.dim}> — {suggestion.hint}</Text>}
                </Text>
              );
            })}
            {suggestions.length > MAX_VISIBLE_SUGGESTIONS && (
              <Text color={colors.dim}>
                {'  '}… {suggestions.length - MAX_VISIBLE_SUGGESTIONS} more
              </Text>
            )}
          </Box>
        )}
        <StatusLine
          config={config}
          displayModel={displayModel}
          status={serverStatus}
          tokenStats={tokenStats}
          contextSize={contextSize}
          permissionsOff={permissionsOff}
        />
      </Box>
    </Box>
  );
}

function initialItems(config: CloverConfig, skills: ReturnType<typeof discoverSkills>): TranscriptItem[] {
  const initial: TranscriptItem[] = [{ kind: 'banner', cwd: config.cwd }];
  if (loadProjectInstructions(config.cwd) !== null) {
    initial.push({ kind: 'info', text: 'project instructions: CLOVER.md' });
  }
  if (skills.length > 0) {
    initial.push({ kind: 'info', text: `skills: ${skills.map((skill) => skill.name).join(', ')}` });
  }
  return initial;
}

function StatusLine({
  config,
  displayModel,
  status,
  tokenStats,
  contextSize,
  permissionsOff,
}: {
  config: CloverConfig;
  displayModel: string;
  status: 'checking' | 'online' | 'offline';
  tokenStats: { contextTokens: number; tokensPerSecond: number | null } | null;
  contextSize: number | null;
  permissionsOff: boolean;
}): React.JSX.Element {
  if (status === 'offline') {
    return (
      <Text color={colors.error} dimColor>
        ○ no signal at {config.baseUrl} — start llama-server with --jinja
      </Text>
    );
  }
  const ctxRatio =
    tokenStats !== null && contextSize !== null ? tokenStats.contextTokens / contextSize : null;
  return (
    <Text color={colors.dim}>
      {status === 'checking' ? '· tuning in…' : `▂ ${displayModel}`} · {shortUrl(config.baseUrl)} ·{' '}
      {shortPath(config.cwd)}
      {tokenStats !== null ? (
        <>
          {' · '}
          <Text color={ctxRatio !== null && ctxRatio > 0.75 ? colors.tool : colors.dim}>
            ctx {formatTokens(tokenStats.contextTokens)}
            {contextSize !== null ? `/${formatTokens(contextSize)}` : ''}
            {ctxRatio !== null && ctxRatio > 0.85 ? ' · /compact suggested' : ''}
          </Text>
          {tokenStats.tokensPerSecond !== null ? ` · ${tokenStats.tokensPerSecond.toFixed(0)} tok/s` : ''}
        </>
      ) : (
        ''
      )}
      {permissionsOff ? ' · permissions off' : ''}
      {config.sandbox ? '' : ' · sandbox off'}
    </Text>
  );
}

function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function shortUrl(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '').replace(/\/v1$/, '');
}

function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function tail(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > REASONING_TAIL ? `…${collapsed.slice(-REASONING_TAIL)}` : collapsed;
}
