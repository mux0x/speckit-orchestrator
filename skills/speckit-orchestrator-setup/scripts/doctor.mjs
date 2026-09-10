#!/usr/bin/env node
import { resolve } from 'node:path';
import { effectiveConfig } from './_config.mjs';
import { runCommand } from './_common.mjs';

function parse(argv) {
  const out = { cwd: process.cwd(), timeoutMs: 10000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cwd') out.cwd = resolve(argv[++i]);
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (a === '-h' || a === '--help') {
      process.stdout.write('Usage: doctor.mjs [--cwd DIR] [--timeout-ms N]\n');
      process.exit(0);
    } else throw new Error(`unknown option: ${a}`);
  }
  return out;
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) || null;
}

async function probe(role, profile, cwd, timeoutMs) {
  if (!profile.enabled) return { role, id: profile.id, adapter: profile.adapter, command: profile.command, status: 'disabled' };
  if (profile.adapter === 'custom' && !Array.isArray(profile.probeArgs)) {
    return { role, id: profile.id, adapter: profile.adapter, command: profile.command, status: 'unprobed', note: 'custom adapter has no probeArgs[]' };
  }
  const args = profile.adapter === 'custom' ? profile.probeArgs : ['--version'];
  const result = await runCommand({
    command: profile.command,
    args,
    cwd,
    stdin: '',
    shell: profile.shell || 'auto',
    timeoutMs,
  });
  const status = result.launchError ? 'unavailable' : result.timedOut ? 'timeout' : result.code === 0 ? 'available' : 'error';
  return {
    role,
    id: profile.id,
    adapter: profile.adapter,
    command: profile.command,
    shell: profile.shell || 'auto',
    status,
    version: firstLine(result.stdout) || firstLine(result.stderr),
    exitCode: result.code ?? null,
    error: result.launchError?.message || null,
  };
}

const opts = parse(process.argv.slice(2));
const effective = effectiveConfig(opts.cwd);
const profiles = [
  ['advisor', effective.config.advisor],
  ...effective.config.workers.map((w) => ['worker', w]),
];
const results = [];
for (const [role, profile] of profiles) results.push(await probe(role, profile, opts.cwd, opts.timeoutMs));
const unavailable = results.filter((x) => x.status === 'unavailable' || x.status === 'error' || x.status === 'timeout');
process.stdout.write(`${JSON.stringify({
  ok: unavailable.length === 0,
  configSource: effective.source,
  configPath: effective.path,
  results,
}, null, 2)}\n`);
