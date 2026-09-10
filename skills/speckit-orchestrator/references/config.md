# Configuration v2

The skill is provider-neutral. Luna remains the orchestrator; the advisor and workers are profiles chosen from configuration.

## Advisor engine and executable selection

The conversational setup wizard presents the advisor as two independent choices:

1. advisor engine/adapter: `codex` or `claude`;
2. exact executable/account alias, for example `codex`, `codex-x`, `claude`, or `claude-review`.

Use:

```bash
node scripts/discover-execs.mjs --adapter codex --cwd "$PWD"
node scripts/discover-execs.mjs --adapter claude --cwd "$PWD"
```

to enumerate matching PATH executables plus shell aliases/functions when possible. `Custom exec/alias` remains valid because shell startup configuration can prevent reliable enumeration. The final selected executable is stored in `advisor.command`; the engine is stored in `advisor.adapter`.


## Paths

Global config:

```text
~/.config/speckit-orchestrator/config.json
```

Optional project override:

```text
<git-root>/.speckit-orchestrator.json
```

Project config wins over global config. If neither exists, built-in defaults apply.

## Schema

```json
{
  "version": 2,
  "advisor": {
    "id": "terra",
    "adapter": "codex",
    "command": "codex",
    "shell": "auto",
    "model": "gpt-5.6-terra",
    "effort": "high",
    "enabled": true
  },
  "workers": [
    {
      "id": "claude-main",
      "adapter": "claude",
      "command": "claude",
      "shell": "auto",
      "model": "claude-opus-5",
      "effort": "medium",
      "enabled": true
    },
    {
      "id": "claude-x",
      "adapter": "claude",
      "command": "claude-x",
      "shell": "auto",
      "model": "claude-opus-5",
      "effort": "medium",
      "enabled": true
    }
  ],
  "execution": {
    "workspaceMode": "worktree",
    "maxParallel": "auto",
    "finalAdvisorAudit": true
  }
}
```

`finalAdvisorAudit` is forced to `true`; it is not a disable switch.

## Profile fields

- `id`: stable name Luna uses for scheduling.
- `adapter`: `claude`, `codex`, `opencode`, or `custom`.
- `command`: executable, wrapper, or shell alias such as `claude-x`, `codex-work`, or `opencode`.
- `shell`: `never`, `always`, or `auto`. `auto` tries direct execution, then interactive-shell alias/function resolution.
- `model`: optional model override. `null` lets the CLI/profile choose its configured default where supported.
- `effort`: optional reasoning level. For OpenCode, this maps to `--variant` unless `variant` is explicitly set.
- `agent`: optional adapter-specific agent name. OpenCode advisor defaults to `plan`; OpenCode worker defaults to `build`.
- `variant`: optional OpenCode/provider-specific variant override.
- `enabled`: worker/advisor availability toggle.

## Common commands

Show effective config:

```bash
node scripts/config.mjs show --cwd "$PWD"
```

Initialize global config:

```bash
node scripts/config.mjs init --scope global
```

### Change advisor

Terra through your normal Codex command:

```bash
node scripts/config.mjs set-advisor codex \
  --adapter codex \
  --id terra \
  --model gpt-5.6-terra \
  --effort high \
  --scope global
```

A second Codex account/alias as advisor, using that alias's configured model:

```bash
node scripts/config.mjs set-advisor codex-x \
  --adapter codex \
  --id codex-review \
  --model null \
  --effort high \
  --scope global
```

Claude as advisor:

```bash
node scripts/config.mjs set-advisor claude-review \
  --adapter claude \
  --model claude-opus-5 \
  --effort high \
  --scope global
```

OpenCode as advisor:

```bash
node scripts/config.mjs set-advisor opencode \
  --adapter opencode \
  --id opencode-review \
  --model anthropic/claude-opus-5 \
  --effort high \
  --agent plan \
  --scope global
```

### Add workers

Claude account/alias:

```bash
node scripts/config.mjs add-worker claude-y \
  --adapter claude \
  --model claude-opus-5 \
  --effort medium \
  --scope global
```

Codex account/alias, letting the alias/config choose the model:

```bash
node scripts/config.mjs add-worker codex-x \
  --adapter codex \
  --model null \
  --scope global
```

OpenCode worker:

```bash
node scripts/config.mjs add-worker opencode \
  --adapter opencode \
  --id opencode-main \
  --model anthropic/claude-opus-5 \
  --effort medium \
  --agent build \
  --scope global
```

Disable or re-enable capacity without deleting it:

```bash
node scripts/config.mjs disable-worker codex-x --scope global
node scripts/config.mjs enable-worker codex-x --scope global
```

Remove:

```bash
node scripts/config.mjs remove-worker codex-x --scope global
```

Validate:

```bash
node scripts/config.mjs validate --cwd "$PWD"
```


## Model and effort discovery during setup

The conversational setup skill uses:

```bash
node scripts/discover-models.mjs --command claude-x --adapter claude --role worker --cwd "$PWD"
node scripts/discover-models.mjs --command codex --adapter codex --role advisor --model gpt-5.6-terra --cwd "$PWD"
node scripts/discover-models.mjs --command opencode --adapter opencode --role worker --cwd "$PWD"
```

Each advisor/worker profile has its own `model` and `effort`; they are not global settings. For OpenCode, `effort` maps to a model `--variant` unless `variant` is explicitly set.

Discovery is intentionally honest about provenance:

- OpenCode can expose configured-provider models through its `models` command, so those entries can be marked live/verified.
- Claude Code and Codex CLI do not have a reliable documented headless account-specific `models list` surface used by this pack; the helper therefore returns fallback/catalog choices plus `CLI/account default` and `Custom model`.
- A fallback choice is not proof the selected account is entitled to that model.
- Custom model and effort/variant strings remain allowed for newer CLI/model releases.

## Adapter behavior

### `claude`

Uses Claude Code print/non-interactive mode. Advisor/read-only runs use restricted tools. Worker runs allow repository editing but the brief and tool restrictions forbid Git integration/delegation.

### `codex`

Uses `codex exec`. Advisor uses a read-only sandbox. Worker uses workspace-write sandbox. Model and reasoning effort are optional profile overrides.

### `opencode`

Uses `opencode run --format json`. Advisor defaults to the `plan` agent. Worker defaults to `build`. `effort` is passed as `--variant` unless `variant` is explicitly set.

Because OpenCode permissions can also be customized globally/project-locally, keep the orchestration brief's "no commit/push/delegate" constraints even when using `build`.

## Custom adapter

For another CLI, use `adapter: "custom"` and edit the JSON profile directly:

```json
{
  "id": "my-agent",
  "adapter": "custom",
  "command": "my-agent-cli",
  "shell": "auto",
  "args": [
    "run",
    "--model", "{model}",
    "--effort", "{effort}",
    "--mode", "{mode}"
  ],
  "model": "some-model",
  "effort": "medium",
  "stdinBrief": true,
  "enabled": true
}
```

Supported placeholders inside `args[]`:

```text
{model}
{effort}
{agent}
{variant}
{workdir}
{briefPath}
{finalPath}
{mode}       -> read-only | write
{brief}
```

`stdinBrief` defaults to `true`. Prefer stdin or `{briefPath}` over `{brief}` for very large prompts.

## v1 migration

v2 reads v1 config automatically:

- `reviewer` becomes `advisor`;
- legacy Claude workers are assigned the `claude` adapter when appropriate;
- `finalTerraAudit` becomes mandatory `finalAdvisorAudit`.

The next config mutation writes the file back in v2 format.
