#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ADAPTERS,
  DEFAULT,
  defaultsForAdapter,
  effectiveConfig,
  inferAdapter,
  normalizeConfig,
  parseJson,
  targetPath,
  validateConfig,
  writeConfig,
} from './_config.mjs';
import { fail } from './_common.mjs';

function help() {
  return `speckit-orchestrator config v2\n\n` +
    `Usage:\n` +
    `  config.mjs show [--cwd DIR]\n` +
    `  config.mjs validate [--cwd DIR]\n` +
    `  config.mjs init --scope global|project [--cwd DIR] [--force]\n` +
    `  config.mjs set-advisor COMMAND [--adapter claude|codex|opencode|custom] [--id ID] [--scope global|project] [--cwd DIR] [--shell auto|always|never] [--model MODEL] [--effort LEVEL] [--agent NAME] [--variant NAME]\n` +
    `  config.mjs add-worker COMMAND [--adapter claude|codex|opencode|custom] [--id ID] [--scope global|project] [--cwd DIR] [--shell auto|always|never] [--model MODEL] [--effort LEVEL] [--agent NAME] [--variant NAME]\n` +
    `  config.mjs remove-worker ID [--scope global|project] [--cwd DIR]\n` +
    `  config.mjs enable-worker ID [--scope global|project] [--cwd DIR]\n` +
    `  config.mjs disable-worker ID [--scope global|project] [--cwd DIR]\n` +
    `  config.mjs set-execution [--workspace worktree|shared] [--max-parallel auto|N] [--scope global|project] [--cwd DIR]\n` +
    `  config.mjs apply FILE [--scope global|project] [--cwd DIR]\n` +
    `  config.mjs adapters\n\n` +
    `For custom adapters, edit config JSON and provide args[] plus optional stdinBrief. See references/config.md.\n`;
}

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    if (key === 'force') { flags.force = true; continue; }
    const v = argv[++i];
    if (v === undefined) fail(`${a} requires a value`);
    flags[key] = v;
  }
  return { positional, flags };
}

function loadTarget(scope, cwd) {
  const path = targetPath(scope, cwd);
  return { path, config: existsSync(path) ? normalizeConfig(parseJson(path)) : normalizeConfig(DEFAULT) };
}

function adapterOrFail(command, explicit) {
  const adapter = explicit || inferAdapter(command);
  if (!adapter) fail(`cannot infer adapter from command '${command}'; pass --adapter ${ADAPTERS.join('|')}`);
  if (!ADAPTERS.includes(adapter)) fail(`--adapter must be ${ADAPTERS.join('|')}`);
  return adapter;
}

function buildProfile({ role, command, flags, existing = null }) {
  const adapter = adapterOrFail(command, flags.adapter || existing?.adapter);
  const defs = defaultsForAdapter(adapter, role);
  const adapterChanged = Boolean(existing && existing.adapter && existing.adapter !== adapter);
  const profile = {
    ...(existing || {}),
    id: flags.id || existing?.id || command,
    adapter,
    command,
    shell: flags.shell || existing?.shell || 'auto',
    enabled: true,
  };

  if (adapterChanged) {
    for (const key of ['model', 'effort', 'agent', 'variant', 'args', 'stdinBrief']) delete profile[key];
  }

  for (const key of ['model', 'effort', 'agent', 'variant']) {
    if (Object.prototype.hasOwnProperty.call(flags, key)) profile[key] = flags[key] === 'null' ? null : flags[key];
    else if (profile[key] === undefined && defs[key] !== undefined) profile[key] = defs[key];
  }
  return profile;
}

const { positional, flags } = parse(process.argv.slice(2));
const action = positional.shift();
if (!action || action === 'help' || action === '-h' || action === '--help') {
  process.stdout.write(help());
  process.exit(0);
}
const cwd = resolve(flags.cwd || process.cwd());

try {
  if (action === 'adapters') {
    process.stdout.write(`${JSON.stringify({ adapters: ADAPTERS }, null, 2)}\n`);
    process.exit(0);
  }

  if (action === 'show') {
    const e = effectiveConfig(cwd);
    process.stdout.write(`${JSON.stringify(e, null, 2)}\n`);
    process.exit(0);
  }

  if (action === 'validate') {
    const e = effectiveConfig(cwd);
    const errors = validateConfig(e.config);
    process.stdout.write(`${JSON.stringify({ ok: errors.length === 0, source: e.source, path: e.path, errors }, null, 2)}\n`);
    process.exit(errors.length ? 1 : 0);
  }

  if (action === 'init') {
    const scope = flags.scope || 'global';
    const path = targetPath(scope, cwd);
    if (existsSync(path) && !flags.force) fail(`${path} already exists; pass --force to replace it`);
    const config = writeConfig(path, DEFAULT);
    process.stdout.write(`${JSON.stringify({ ok: true, action: 'init', scope, path, config }, null, 2)}\n`);
    process.exit(0);
  }

  if (action === 'apply') {
    const file = positional.shift();
    if (!file) fail('apply requires FILE');
    const scope = flags.scope || 'global';
    const path = targetPath(scope, cwd);
    const draftPath = resolve(cwd, file);
    const raw = JSON.parse(readFileSync(draftPath, 'utf8'));
    const written = writeConfig(path, raw);
    process.stdout.write(`${JSON.stringify({ ok: true, action: 'apply', scope, path, config: written }, null, 2)}\n`);
    process.exit(0);
  }

  if (action === 'set-execution') {
    const scope = flags.scope || 'global';
    const { path, config } = loadTarget(scope, cwd);
    if (flags.workspace !== undefined) {
      if (!['worktree', 'shared'].includes(flags.workspace)) fail('--workspace must be worktree|shared');
      config.execution.workspaceMode = flags.workspace;
    }
    if (flags['max-parallel'] !== undefined) {
      const raw = flags['max-parallel'];
      if (raw === 'auto') config.execution.maxParallel = 'auto';
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) fail('--max-parallel must be auto or a positive integer');
        config.execution.maxParallel = n;
      }
    }
    config.execution.finalAdvisorAudit = true;
    const written = writeConfig(path, config);
    process.stdout.write(`${JSON.stringify({ ok: true, action: 'set-execution', scope, path, execution: written.execution }, null, 2)}\n`);
    process.exit(0);
  }

  if (action === 'set-advisor') {
    const command = positional.shift();
    if (!command) fail('set-advisor requires COMMAND');
    const scope = flags.scope || 'global';
    const { path, config } = loadTarget(scope, cwd);
    config.advisor = buildProfile({ role: 'advisor', command, flags, existing: config.advisor });
    const written = writeConfig(path, config);
    process.stdout.write(`${JSON.stringify({ ok: true, action: 'set-advisor', scope, path, advisor: written.advisor }, null, 2)}\n`);
    process.exit(0);
  }

  if (action === 'add-worker') {
    const command = positional.shift();
    if (!command) fail('add-worker requires COMMAND');
    const scope = flags.scope || 'global';
    const { path, config } = loadTarget(scope, cwd);
    const id = flags.id || command;
    const existing = config.workers.find((w) => w.id === id) || null;
    const worker = buildProfile({ role: 'worker', command, flags: { ...flags, id }, existing });
    config.workers = config.workers.filter((w) => w.id !== id);
    config.workers.push(worker);
    const written = writeConfig(path, config);
    process.stdout.write(`${JSON.stringify({ ok: true, action: 'add-worker', scope, path, worker: written.workers.at(-1) }, null, 2)}\n`);
    process.exit(0);
  }

  if (action === 'remove-worker' || action === 'enable-worker' || action === 'disable-worker') {
    const id = positional.shift();
    if (!id) fail(`${action} requires ID`);
    const scope = flags.scope || 'global';
    const { path, config } = loadTarget(scope, cwd);
    const worker = config.workers.find((w) => w.id === id);
    if (!worker) fail(`worker not found: ${id}`);
    if (action === 'remove-worker') config.workers = config.workers.filter((w) => w.id !== id);
    else worker.enabled = action === 'enable-worker';
    const written = writeConfig(path, config);
    process.stdout.write(`${JSON.stringify({ ok: true, action, scope, path, id, workers: written.workers }, null, 2)}\n`);
    process.exit(0);
  }

  fail(`unknown action: ${action}`);
} catch (e) {
  fail(e.message || String(e));
}
