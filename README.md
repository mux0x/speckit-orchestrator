# SpecKit Orchestrator

This pack contains two Agent Skills:

- `speckit-orchestrator` — Luna-led spec audit, approval-gated parallel execution, review, integration, and mandatory final independent advisor certification.
- `speckit-orchestrator-setup` — a true one-question-at-a-time conversational wizard for advisor/workers, including **per-agent CLI-aware model and effort selection**.

## Install 

```bash
npx skills add mux0x/speckit-orchestrator
```

## Setup

Invoke:

```text
$speckit-orchestrator-setup
```

The wizard starts by asking scope immediately. It then asks whether the independent advisor should use **Codex or Claude**, discovers matching executable/account aliases for that engine, lets you choose the exact exec, then asks for advisor model + effort. After that it asks for worker CLI accounts and asks **model + effort/variant separately for every worker**.
 spec

```text
Use $speckit-orchestrator on specs/<spec-dir>
```
