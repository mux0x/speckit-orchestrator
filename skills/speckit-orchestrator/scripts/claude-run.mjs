#!/usr/bin/env node
// Compatibility wrapper for v1. Prefer: agent-run.mjs --profile worker:<id> ...
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const args = [join(here, 'agent-run.mjs'), '--adapter', 'claude', '--command', 'claude', ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
