#!/usr/bin/env node
import { accessSync, constants, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { effectiveConfig } from './_config.mjs';
import { runCommand } from './_common.mjs';

function fail(message) {
  process.stderr.write(`discover-execs: ${message}\n`);
  process.exit(2);
}

function parse(argv) {
  const out = { adapter: null, cwd: process.cwd(), timeoutMs: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--adapter') out.adapter = argv[++i];
    else if (a === '--cwd') out.cwd = argv[++i];
    else if (a === '--timeout') out.timeoutMs = Number(argv[++i]);
    else if (a === '-h' || a === '--help') {
      process.stdout.write('Usage: discover-execs.mjs --adapter claude|codex [--cwd DIR] [--timeout MS]\n');
      process.exit(0);
    } else fail(`unknown option: ${a}`);
  }
  if (!['claude', 'codex'].includes(out.adapter)) fail('--adapter must be claude or codex');
  out.cwd = resolve(out.cwd);
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs < 500) out.timeoutMs = 5000;
  return out;
}

const opts = parse(process.argv.slice(2));
const prefix = opts.adapter;
const nameMatches = (name) => name === prefix || name.startsWith(`${prefix}-`) || name.startsWith(`${prefix}_`);
const byName = new Map();

function add(name, source, detail = null) {
  name = String(name || '').trim();
  if (!nameMatches(name)) return;
  const existing = byName.get(name) || { command: name, sources: [], details: [] };
  if (!existing.sources.includes(source)) existing.sources.push(source);
  if (detail && !existing.details.includes(detail)) existing.details.push(detail);
  byName.set(name, existing);
}

// Always make the canonical executable selectable, even if probing later fails.
add(prefix, 'default');

// Existing orchestrator config is useful because aliases may not be enumerable from a non-interactive process.
try {
  const { config } = effectiveConfig(opts.cwd);
  if (config.advisor?.adapter === opts.adapter) add(config.advisor.command, 'existing-config', 'advisor');
  for (const worker of config.workers || []) {
    if (worker?.adapter === opts.adapter) add(worker.command, 'existing-config', `worker:${worker.id}`);
  }
} catch {}

// Discover executable files on PATH whose basename follows the adapter naming convention.
for (const dir of String(process.env.PATH || '').split(':').filter(Boolean)) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { continue; }
  for (const entry of entries) {
    if (!nameMatches(entry)) continue;
    const full = join(dir, entry);
    try {
      accessSync(full, constants.X_OK);
      add(entry, 'PATH', full);
    } catch {}
  }
}

// Discover aliases/functions from the user's configured interactive shell when possible.
const shell = process.env.SHELL;
if (shell) {
  const shellName = basename(shell);
  let enumerate = null;
  if (shellName === 'zsh') {
    enumerate = `alias 2>/dev/null; printf '\\n__SPECKIT_FUNCTIONS__\\n'; print -rl -- \${(k)functions} 2>/dev/null`;
  } else if (shellName === 'bash') {
    enumerate = `alias 2>/dev/null; printf '\\n__SPECKIT_FUNCTIONS__\\n'; compgen -A function 2>/dev/null`;
  } else if (shellName === 'fish') {
    enumerate = `alias 2>/dev/null; printf '\\n__SPECKIT_FUNCTIONS__\\n'; functions -n 2>/dev/null`;
  }

  if (enumerate) {
    const r = spawnSync(shell, ['-ic', enumerate], {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: Math.max(opts.timeoutMs * 2, 8000),
      env: process.env,
    });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const [aliasText, functionText = ''] = text.split('__SPECKIT_FUNCTIONS__');
    for (const raw of aliasText.split(/\r?\n/)) {
      const line = raw.trim();
      let m = line.match(/^alias\s+([A-Za-z0-9_.-]+)=/);
      if (!m) m = line.match(/^([A-Za-z0-9_.-]+)=/); // zsh alias output
      if (m) add(m[1], 'shell-alias', shellName);
    }
    for (const raw of functionText.split(/\r?\n/)) {
      const token = raw.trim().split(/\s+/)[0];
      if (/^[A-Za-z0-9_.-]+$/.test(token || '')) add(token, 'shell-function', shellName);
    }
  }
}

const candidates = [];
for (const item of [...byName.values()].sort((a, b) => {
  if (a.command === prefix) return -1;
  if (b.command === prefix) return 1;
  return a.command.localeCompare(b.command);
})) {
  let probe = null;
  try {
    const r = await runCommand({
      command: item.command,
      args: ['--version'],
      cwd: opts.cwd,
      stdin: '',
      shell: 'auto',
      timeoutMs: opts.timeoutMs,
    });
    probe = {
      available: !r.launchError && !r.timedOut && r.code === 0,
      timedOut: Boolean(r.timedOut),
      error: r.launchError?.message || null,
      version: String(r.stdout || r.stderr || '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim().split(/\r?\n/).find(Boolean) || null,
    };
  } catch (error) {
    probe = { available: false, timedOut: false, error: error.message || String(error), version: null };
  }
  candidates.push({ ...item, ...probe });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  adapter: opts.adapter,
  cwd: opts.cwd,
  shell: shell || null,
  candidates,
  allowCustomExec: true,
  defaultCommand: prefix,
  note: 'Candidates come from PATH, existing orchestrator config, and enumerable interactive-shell aliases/functions. Shell startup rules can hide aliases; Custom exec is always allowed.',
}, null, 2)}\n`);
