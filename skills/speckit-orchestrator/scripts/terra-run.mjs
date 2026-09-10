#!/usr/bin/env node
// Compatibility wrapper for v1. Prefer: agent-run.mjs --profile advisor ...
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const args = [join(here, 'agent-run.mjs'), '--adapter', 'codex', '--command', 'codex', '--model', 'gpt-5.6-terra', '--effort', 'high', '--read-only', ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
