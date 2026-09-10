# Interactive Conversational Setup Wizard v2.2.1

This wizard is run by the current AI agent through normal conversation. It is **not** a terminal/readline wizard. Helper scripts are only for config persistence, executable/account discovery, command probing, and CLI/model discovery.

## Non-negotiable interaction behavior

1. On fresh invocation, ask the first setup question before running any tool or command.
2. Ask exactly **one setup question per assistant turn** unless the human explicitly requests a batch form.
3. Stop after each question and wait for the answer.
4. Never start with `Recommended vs Customize`.
5. Do not persist configuration until the final summary is shown and the human explicitly confirms saving.
6. Show a default in brackets for every optional choice.
7. Accept `default`, `same`, `recommended`, or an obvious equivalent where applicable.
8. If the human says `use defaults for the rest`, fill remaining optional choices with defaults, run required probes/discovery, show the final summary, then ask only the save confirmation.
9. Final advisor certification is mandatory and is never offered as a disable option.
10. For every advisor/worker, model and reasoning effort/variant are configured **per profile**, not globally for all agents.
11. The advisor setup is deliberately two-stage: **choose advisor engine (`Codex` or `Claude`) first, then choose the exact executable/account alias for that engine**. Do not collapse those into one free-text question on fresh setup.

## Executable/account discovery

After the human chooses an advisor engine, run:

```bash
node "<skill-dir>/scripts/discover-execs.mjs" \
  --adapter codex|claude \
  --cwd "$PWD"
```

Use the returned `candidates` to offer the exact executable/account aliases detected from PATH, existing orchestrator config, and enumerable interactive-shell aliases/functions. Examples can include:

```text
codex
codex-x
codex-work
```

or:

```text
claude
claude-x
claude-review
```

Rules:

- Show only candidates matching the selected advisor engine.
- Prefer candidates with `available: true` at the top.
- Always include `Custom exec/alias…` because some shell startup rules make aliases impossible to enumerate reliably.
- Never switch the advisor engine merely because an executable probe failed.
- The selected exact command is stored as `advisor.command`; the chosen engine becomes `advisor.adapter`.
- A command like `claude-x` is an account/profile executable using the `claude` adapter; a command like `codex-x` uses the `codex` adapter.

## Model-discovery rule

After an exact CLI command/alias is chosen, run:

```bash
node "<skill-dir>/scripts/discover-models.mjs" \
  --command "<exact-command-or-alias>" \
  --adapter <adapter> \
  --role advisor|worker \
  --cwd "$PWD"
```

For effort/variant choices after a model is selected, rerun with:

```bash
node "<skill-dir>/scripts/discover-models.mjs" \
  --command "<exact-command-or-alias>" \
  --adapter <adapter> \
  --role advisor|worker \
  --model "<selected-model>" \
  --cwd "$PWD"
```

Interpret the result honestly:

- `modelDiscovery.source = live-cli` and `verified = true` means the model list came from that CLI/account at setup time.
- `fallback-catalog` means the CLI has no reliable headless model-list surface available to this skill. Present those as **known/fallback choices, not verified account availability**.
- Always offer `CLI/account default` and `Custom model…` even when live discovery succeeds.
- For OpenCode workers, `opencode models` can provide a live configured-provider model list. OpenCode reasoning choices are model variants.
- For Claude Code and Codex CLI, do not pretend the fallback catalog is a live account entitlement list.
- If the human gives a model/effort not listed, accept it as a custom override after a brief warning; the execution runner will pass it to that CLI.

Do not silently pick a different model because discovery failed.

## Defaults

- Scope: `global`
- Advisor engine: `Codex`
- Advisor adapter: `codex`
- Advisor command/account: `codex`
- Advisor model: `gpt-5.6-terra`
- Advisor effort: `high`
- Workers: `claude`, `claude-x`
- Claude worker model: `claude-opus-5`
- Claude worker effort: `medium`
- Workspace mode: `worktree`
- Max parallelism: `auto`
- Final advisor audit: `true` always

## Fresh setup flow

### Step 1 — Scope

The **first assistant response** must ask only this compact question:

> Where should I save the orchestrator configuration: globally for all repositories, or only for this project? **[Global]**

Do not inspect configuration or commands before this answer.

After scope is known, inspect existing effective config silently:

```bash
node "<skill-dir>/scripts/config.mjs" show --cwd "$PWD"
```

Preserve useful existing values unless the human changes them.

### Step 2 — Advisor engine

Ask exactly:

> Which engine should be the independent advisor?  
> 1. **Codex [default]**  
> 2. Claude

On a fresh/default setup, choose `codex`. If the effective existing configuration already has a Claude advisor and the human is editing rather than resetting, use that current engine as the displayed default.

The advisor is an independent critic/final certifier. It is not a worker lane.

### Step 3 — Advisor executable/account

After the engine answer, silently run `discover-execs.mjs` for the chosen adapter.

Then ask one question listing the discovered matching executable/accounts. Example for Claude:

> Which Claude executable/account should I use for the advisor?  
> 1. `claude` **[default]**  
> 2. `claude-x`  
> 3. `claude-review`  
> 4. Custom exec/alias…

Example for Codex:

> Which Codex executable/account should I use for the advisor?  
> 1. `codex` **[default]**  
> 2. `codex-x`  
> 3. Custom exec/alias…

Only show entries actually discovered/currently configured, plus the canonical default and `Custom exec/alias…`. If only the canonical executable is known, show it plus custom.

If the selected command is unavailable, ask one focused follow-up: keep it configured, enter another exec/alias, or go back to advisor engine. Default: enter another exec/alias when no working command of that engine is known; otherwise keep configured.

### Step 4 — Advisor model

Run `discover-models.mjs` using the **chosen advisor executable/account and adapter**, then ask one model question.

For Codex fallback choices, for example:

> Model for advisor `codex-x`? The CLI does not expose a reliable headless account model list here, so these are known choices rather than verified entitlements:  
> 1. `gpt-5.6-terra` **[default]**  
> 2. `gpt-5.6-sol`  
> 3. `gpt-5.6-luna`  
> 4. CLI/account default  
> 5. Custom model…

For Claude fallback choices, for example:

> Model for advisor `claude-x`? These are known Claude choices rather than a verified account entitlement list:  
> 1. `claude-opus-5` **[default]**  
> 2. `claude-sonnet-5`  
> 3. CLI/account default  
> 4. Custom model…

When live choices exist, say they were discovered from that CLI/account and show a compact numbered list. Do not call fallback choices “available” when they were not verified.

`CLI/account default` stores `model: null`.

### Step 5 — Advisor effort

Rerun discovery with the chosen advisor model and ask one effort question.

For Codex:

> Effort for advisor `codex-x` using `gpt-5.6-terra`? **[High]**  
> `Default / Medium / High / Custom…`

For Claude Opus:

> Effort for advisor `claude-x` using `claude-opus-5`? **[High]**  
> `Default / Low / Medium / High / XHigh / Max / Custom…`

`Default` stores `effort: null`.

### Step 6 — Worker commands/accounts

Ask:

> Which coding CLI accounts/aliases should Luna manage? Separate them with commas. **[`claude`, `claude-x`]**

Examples:

```text
claude, claude-x, codex-x, codex-y, opencode
```

Keep each exact command/alias. Workers may mix providers. They are not permanent lanes.

### Steps 7+ — Configure each worker independently

Process workers in the order supplied. For **each worker**, do not batch model+effort into one question unless the human explicitly asks for batch mode.

For the current worker:

1. Infer adapter or ask for it if ambiguous.
2. Run `discover-models.mjs --role worker` for that exact command/alias.
3. If unavailable, ask whether to keep, replace, or remove it. Default: keep configured.
4. Ask **model for this worker** using live/fallback choices and `CLI/account default` + `Custom model…`.
5. Rerun discovery with the selected model.
6. Ask **effort/variant for this worker** using model-aware choices.
7. Store that model/effort only on this worker profile.
8. Move to the next worker.

Example sequence:

```text
Model for `claude`? [claude-opus-5]
→ human answers

Effort for `claude`? [Medium]
→ human answers

Model for `claude-x`? [claude-opus-5]
→ human answers

Effort for `claude-x`? [Medium]
→ human answers

Model for `codex-x`? [CLI/account default]
→ human answers

Effort for `codex-x`? [Default]
```

Support `same as previous` for model and/or effort when adapters are compatible. Never silently copy settings across different CLI adapters.

### Next — Worktree isolation

After every worker has its own model+effort configuration, ask:

> Use isolated Git worktrees for parallel tasks? **[Yes]**

Default -> `workspaceMode: worktree`.

### Next — Parallelism

Ask:

> Maximum parallel workers? **[Auto]**

`auto` means Luna chooses safe concurrency from dependency/collision analysis; it does not mean “run every account”.

### Final — Summary and save

Before any write, show a compact summary including advisor engine **and exact exec/account** plus source/verification status for models where useful:

```text
Scope: global

Advisor
- engine: Claude
- exec/account: claude-review
- model: claude-opus-5
- effort: high

Workers
- claude-main -> claude
  model: claude-opus-5
  effort: medium
- claude-x -> claude-x
  model: claude-opus-5
  effort: medium
- codex-x -> codex-x
  model: CLI/account default
  effort: default

Workspace: worktree
Max parallel: auto
Final advisor audit: mandatory
Command checks: ...
```

Then ask exactly:

> Save this configuration? **[Yes]**

Only after explicit confirmation, create a complete draft JSON and persist it with:

```bash
node "<skill-dir>/scripts/config.mjs" apply /path/to/draft.json --scope global|project --cwd "$PWD"
node "<skill-dir>/scripts/config.mjs" validate --cwd "$PWD"
node "<skill-dir>/scripts/config.mjs" show --cwd "$PWD"
node "<skill-dir>/scripts/doctor.mjs" --cwd "$PWD"
```

Report saved scope/path and final profiles. Do not start spec implementation.

## Existing configuration / later edits

On later invocation, still start with scope unless the human already specified it. After scope is known, inspect current config and ask one question about what to change.

Supported conversational edits include:

- switch advisor engine between Codex and Claude;
- change advisor executable/account alias within the selected engine;
- change advisor model or effort;
- add/remove/disable worker;
- change one worker's CLI command;
- change one worker's model;
- change one worker's effort/variant;
- re-discover models for an existing profile;
- change worktree/shared mode;
- change max parallelism;
- rerun full setup.

For advisor engine/exec edits, use `discover-execs.mjs` before presenting exec choices. For any profile model/effort edit, rerun `discover-models.mjs` first so choices are as current as the CLI permits. Show a final diff/summary and ask for save confirmation before mutation.

## Batch mode

If the human explicitly says `ask me everything at once`, present a numbered form. Even in batch mode, advisor fields are `engine -> exec/account -> model -> effort`, and every worker gets independent `command -> model -> effort` fields.
