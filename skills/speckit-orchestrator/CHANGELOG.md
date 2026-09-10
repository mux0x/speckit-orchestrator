# Changelog

## 2.2.1

- Advisor setup now explicitly asks **Codex or Claude** before asking for the executable/account.
- Added `discover-execs.mjs` to find matching PATH executables plus enumerable shell aliases/functions such as `codex-x` and `claude-review`.
- Advisor executable/account is selected independently from advisor model and effort.
- `Custom exec/alias` remains available when shell aliases cannot be enumerated reliably.
- Preserved Codex/Terra High as the fresh-install default while allowing Claude to be the independent advisor/final certifier.

## 2.2.0

- Reworked setup into a true one-question-at-a-time conversational wizard from the first response.
- Removed the `Recommended vs Customize` gate.
- Added CLI-aware `discover-models.mjs` helper.
- Added per-profile model selection for the advisor and every worker.
- Added per-profile effort/variant selection for the advisor and every worker.
- OpenCode model discovery uses its live `models` command when available.
- Claude/Codex fallback catalogs are explicitly labeled as non-live when the CLI cannot expose an account-specific model list headlessly.
- Added `CLI/account default`, `Custom model`, custom effort/variant, and `same as previous` setup paths.
- Preserved provider-neutral advisor/worker architecture and mandatory final advisor certification.
