# SpecKit Orchestrator v2.2.1 Skill Pack

This pack contains two Agent Skills:

- `speckit-orchestrator` — Luna-led spec audit, approval-gated parallel execution, review, integration, and mandatory final independent advisor certification.
- `speckit-orchestrator-setup` — a true one-question-at-a-time conversational wizard for advisor/workers, including **per-agent CLI-aware model and effort selection**.

## Install after unzip

```bash
npx skills@latest add . --skill speckit-orchestrator --skill speckit-orchestrator-setup --global
```

Or:

```bash
npx skills@latest add . --skill '*' --global
```

## Setup

Invoke:

```text
$speckit-orchestrator-setup
```

The wizard starts by asking scope immediately. It then asks whether the independent advisor should use **Codex or Claude**, discovers matching executable/account aliases for that engine, lets you choose the exact exec, then asks for advisor model + effort. After that it asks for worker CLI accounts and asks **model + effort/variant separately for every worker**.

Model discovery behavior:

- OpenCode: uses `opencode models`, so configured-provider models can be discovered live.
- Claude Code / Codex CLI: when no reliable headless model-list command is exposed, the wizard clearly labels a fallback catalog and still offers `CLI/account default` and `Custom model`.
- Every profile can use a different model and effort.

Reply `default` to accept the current question's default, `same as previous` when appropriate, or `use defaults for the rest` to jump to the final summary/save confirmation.

## Run a spec

```text
Use $speckit-orchestrator on specs/<spec-dir>
```
# speckit-orchestrator
