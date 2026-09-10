# SpecKit Orchestrator v2.2.1

A Luna-led orchestration skill for implementing completed SpecKit specs with a configurable independent advisor and a heterogeneous worker pool.

Default roles:

- Luna: sole orchestrator/state owner
- Terra high through Codex CLI: read-only advisor
- `claude` + `claude-x`: implementation workers

Workers/advisor can be Claude Code, Codex CLI, OpenCode, aliases/accounts, or custom CLI adapters. Every profile can have its own model and reasoning effort/variant.

## Install from the v2.2.1 pack

From the unpacked pack root:

```bash
npx skills@latest add . --skill speckit-orchestrator --skill speckit-orchestrator-setup --global
```

## Interactive setup

```text
$speckit-orchestrator-setup
```

The setup skill asks one question at a time. The advisor flow is explicit:

```text
Codex or Claude -> exact exec/account -> model -> effort
```

Workers then go through:

```text
CLI/account -> model -> effort/variant
```

OpenCode model choices can be discovered live through its configured providers. Where a CLI has no reliable headless model-list surface, the wizard labels its catalog as fallback and offers CLI/account default plus custom model/effort overrides.

## Invoke a spec

```text
Use $speckit-orchestrator on specs/<spec-dir>
```

The skill audits first, surfaces genuine user decisions, proposes a dependency-safe parallel plan, waits for approval, executes dynamically, reviews every worker result, and requires final independent advisor compliance on the current integrated HEAD before `DONE`.

See `references/config.md` for configuration schema and `references/setup-wizard.md` for the conversational wizard contract.
