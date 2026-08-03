# OpenCode Goal

[![CI](https://github.com/beremaran/opencode-goal/actions/workflows/ci.yml/badge.svg)](https://github.com/beremaran/opencode-goal/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@beremaran/opencode-goal)](https://www.npmjs.com/package/@beremaran/opencode-goal)
[![license](https://img.shields.io/npm/l/@beremaran/opencode-goal)](LICENSE)

A persistent `/goal` workflow for [OpenCode](https://opencode.ai): define a
completion condition once, let OpenCode work across turns, and stop only when
an independent evaluator finds enough evidence that the condition is
satisfied.

The plugin combines:

- Claude Code-style completion evaluation after every turn.
- Codex-style session persistence, token accounting, pause/resume controls,
  model tools, and idle continuation.
- Optional token and turn budgets to cap unattended runs.

Requires OpenCode 1.18 or newer.

## Install

Install both the server workflow and TUI integration with OpenCode's plugin
installer:

```bash
opencode plugin @beremaran/opencode-goal
```

The installer detects the package's server and TUI entrypoints and updates both
configuration files. Restart OpenCode after installation.

For manual installation, add the package to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@beremaran/opencode-goal"]
}
```

Then add the same package to `tui.json` to enable the sidebar:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@beremaran/opencode-goal"]
}
```

OpenCode installs npm plugins automatically when it starts.

## Usage

```text
/goal all authentication tests pass and lint is clean
/goal --tokens 100k migrate every call site and make the build pass
/goal --max-turns 20 diagnose and fix the intermittent queue test
```

Control the current session goal with:

```text
/goal          Show status, elapsed time, turns, tokens, and the last evaluation
/goal pause    Pause automatic continuation
/goal resume   Resume work immediately
/goal clear    Remove the session goal
/goal help     Show command syntax
```

An explicit budget is optional. Without `--tokens` or `--max-turns`, the goal
remains active until it completes, is paused, is cleared, or is marked blocked.

## TUI sidebar

When the TUI entrypoint is enabled, the current session's goal appears in a
collapsible **Goal** section beside OpenCode's Todo and Files sections. It shows:

- Status and objective.
- Elapsed time, turns, and tokens used.
- The latest independent evaluator reason.
- Token and turn budget bars when those limits are configured.

Budget bars show consumption of the configured limits, not an estimated
percentage of semantic goal completion. The section disappears when the session
has no goal.

## How it works

1. The config hook registers `/goal`.
2. The command hook stores a per-session goal and turns the command into the
   first work prompt.
3. When the parent session becomes idle, the plugin reads the goal-period
   transcript and accounts for input, output, and reasoning tokens. Cache
   tokens are excluded.
4. A temporary child session evaluates the completion condition with tools
   disabled. The evaluator model is selected in this order:
   - Plugin option `evaluatorModel`
   - OpenCode `small_model`
   - The parent session model
5. A negative decision and its reason are injected through
   `session.promptAsync()`, starting the next turn.
6. A positive decision marks the durable goal complete and stops continuation.

The plugin also exposes two model tools:

- `get_goal` returns the current state and remaining budget.
- `update_goal` records a completion claim for independent evaluation, or marks
  a genuinely repeated blocker after at least three goal turns.

Active goal context is re-injected into system prompts and compaction context.
Interrupting an OpenCode response pauses the goal so pressing Escape does not
immediately restart it.

## Configuration

Plugin options can be supplied in an OpenCode plugin entry:

```json
{
  "plugin": [
    [
      "@beremaran/opencode-goal",
      {
        "evaluatorModel": "anthropic/claude-haiku-4-5",
        "maxTranscriptChars": 48000,
        "continuationDelayMs": 250,
        "defaultTokenBudget": 200000,
        "defaultMaxTurns": 50,
        "deleteEvaluatorSessions": true,
        "stateDirectory": "/custom/state/root"
      }
    ]
  ]
}
```

All options are optional. By default, budgets are unbounded and evaluator
sessions are deleted after use.

If manual server and TUI configuration uses a custom `stateDirectory`, provide
the same value in both `opencode.json` and `tui.json` so the sidebar reads the
server's state.

State is stored outside the repository under:

```text
$XDG_STATE_HOME/opencode-goal/<project-id>/<session-id>.json
```

When `XDG_STATE_HOME` is unset, the root is
`~/.local/state/opencode-goal`.

## Limitations

- The stable server plugin API can register a prompt-backed slash command, so
  status and control commands each create a normal OpenCode turn.
- Evaluators can judge only transcript evidence. If work happened but the
  agent did not surface it, the evaluator should ask for stronger evidence and
  continue.
- This plugin cannot bypass provider rate, usage, trust, or permission limits.
- A provider or model failure pauses the goal instead of risking an unverified
  runaway loop. The goal remains persisted and can be resumed.
- The sidebar entrypoint is specific to OpenCode's terminal TUI. Other OpenCode
  clients can use `/goal` for status.

## Local development

```bash
git clone https://github.com/beremaran/opencode-goal.git
cd opencode-goal
npm install
npm run check
```

To load the checkout directly, add its absolute path to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-goal"]
}
```

Run `npm run build` and restart OpenCode after changing the plugin.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and
[RELEASING.md](RELEASING.md) for maintainer release instructions.

## License

[MIT](LICENSE)

The design follows OpenCode's documented
[plugin hooks](https://opencode.ai/docs/plugins/) and
[custom commands](https://opencode.ai/docs/commands/). Completion behavior is
modeled on Claude Code's documented
[`/goal` loop](https://code.claude.com/docs/en/goal), while persistence and
optional token budgeting follow Codex's goal lifecycle.
