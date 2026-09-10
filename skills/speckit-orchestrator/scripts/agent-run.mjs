#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { effectiveConfig, resolveProfile } from './_config.mjs';
import {
  changedPaths,
  fail,
  gitStatus,
  parseDuration,
  parseJsonBestEffort,
  prepareRunDir,
  readBrief,
  runCommand,
  tail,
  writeJsonAtomic,
} from './_common.mjs';

function help() {
  return `Run one advisor or worker through a provider adapter.\n\n` +
    `Preferred usage (loads config):\n` +
    `  agent-run.mjs --profile advisor --brief FILE [--cd DIR] [--timeout 1h]\n` +
    `  agent-run.mjs --profile worker:claude-main --brief FILE [--cd DIR] [--timeout 2h]\n\n` +
    `Manual usage/overrides:\n` +
    `  agent-run.mjs --adapter claude|codex|opencode|custom --command CMD --brief FILE [--read-only] [--model MODEL] [--effort LEVEL] [--agent NAME] [--variant NAME] [--shell auto|always|never] [--session ID] [--max-turns N] [--out-dir DIR]\n`;
}

function parse(argv) {
  const opts = {
    profile: null,
    brief: null,
    cd: process.cwd(),
    adapter: null,
    command: null,
    shell: null,
    model: undefined,
    effort: undefined,
    agent: undefined,
    variant: undefined,
    timeout: null,
    outDir: null,
    readOnly: null,
    session: null,
    maxTurns: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) fail(`${a} requires a value`); return v; };
    switch (a) {
      case '-h': case '--help': process.stdout.write(help()); process.exit(0);
      case '--profile': opts.profile = next(); break;
      case '--brief': opts.brief = resolve(next()); break;
      case '--cd': opts.cd = resolve(next()); break;
      case '--adapter': opts.adapter = next(); break;
      case '--command': opts.command = next(); break;
      case '--shell': opts.shell = next(); break;
      case '--model': opts.model = next(); break;
      case '--effort': opts.effort = next(); break;
      case '--agent': opts.agent = next(); break;
      case '--variant': opts.variant = next(); break;
      case '--timeout': opts.timeout = next(); break;
      case '--out-dir': opts.outDir = resolve(next()); break;
      case '--read-only': opts.readOnly = true; break;
      case '--write': opts.readOnly = false; break;
      case '--session': opts.session = next(); break;
      case '--max-turns': opts.maxTurns = next(); break;
      default: fail(`unknown option: ${a}`);
    }
  }
  if (opts.shell && !['auto', 'always', 'never'].includes(opts.shell)) fail('--shell must be auto|always|never');
  if (opts.timeout && parseDuration(opts.timeout) == null) fail('invalid --timeout; use e.g. 30m, 2h, 1h30m');
  if (opts.maxTurns && !/^[1-9]\d*$/.test(opts.maxTurns)) fail('--max-turns must be a positive integer');
  return opts;
}

function mergeProfile(opts) {
  let role = 'worker';
  let profile = {};
  let configMeta = null;

  if (opts.profile) {
    const e = effectiveConfig(opts.cd);
    const resolved = resolveProfile(e.config, opts.profile);
    role = resolved.role;
    profile = { ...resolved.profile };
    configMeta = { source: e.source, path: e.path, selector: opts.profile };
  }

  for (const key of ['adapter', 'command', 'shell', 'model', 'effort', 'agent', 'variant']) {
    if (opts[key] !== null && opts[key] !== undefined) profile[key] = opts[key];
  }

  if (!profile.adapter) fail('missing adapter; pass --profile or --adapter');
  if (!profile.command) fail('missing command; pass --profile or --command');
  profile.shell ||= 'auto';

  const readOnly = opts.readOnly !== null ? opts.readOnly : role === 'advisor';
  return { role, profile, readOnly, configMeta };
}

function expandCustomArg(value, ctx) {
  return String(value).replace(/\{(model|effort|agent|variant|workdir|briefPath|finalPath|mode|brief)\}/g, (_, key) => String(ctx[key] ?? ''));
}

function buildInvocation(adapter, profile, ctx, opts) {
  const model = profile.model;
  const effort = profile.effort;

  if (adapter === 'claude') {
    const args = ['-p', '--output-format', 'json', '--disable-slash-commands'];
    if (opts.session) args.push('--resume', opts.session);
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (opts.maxTurns) args.push('--max-turns', opts.maxTurns);
    if (ctx.readOnly) {
      args.push('--permission-mode', 'plan');
      args.push('--allowedTools', 'Read,Glob,Grep');
      args.push('--disallowedTools', 'Edit,Write,Bash,Agent');
    } else {
      args.push('--permission-mode', 'acceptEdits');
      args.push('--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash');
      args.push('--disallowedTools', 'Agent,Bash(git commit *),Bash(git push *),Bash(git merge *),Bash(git checkout *),Bash(git switch *),Bash(git worktree *),Bash(claude *),Bash(codex *),Bash(opencode *)');
    }
    return { args, stdin: ctx.brief, finalMode: 'claude-json' };
  }

  if (adapter === 'codex') {
    const args = ['exec', '--json', '-o', ctx.finalPath, '-s', ctx.readOnly ? 'read-only' : 'workspace-write'];
    if (model) args.push('-m', model);
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`);
    args.push('-');
    return { args, stdin: ctx.brief, finalMode: 'final-file-codex-events' };
  }

  if (adapter === 'opencode') {
    const args = ['run', '--format', 'json', '--dir', ctx.workdir];
    if (model) args.push('--model', model);
    const selectedAgent = profile.agent || (ctx.readOnly ? 'plan' : 'build');
    if (selectedAgent) args.push('--agent', selectedAgent);
    const selectedVariant = profile.variant || effort;
    if (selectedVariant) args.push('--variant', selectedVariant);
    if (opts.session) args.push('--session', opts.session);
    if (!ctx.readOnly) args.push('--auto');
    args.push(ctx.brief);
    return { args, stdin: '', finalMode: 'opencode-json-events' };
  }

  if (adapter === 'custom') {
    if (!Array.isArray(profile.args)) fail('custom adapter requires profile.args[] in config');
    const customCtx = {
      ...ctx,
      model: model || '',
      effort: effort || '',
      agent: profile.agent || '',
      variant: profile.variant || '',
      mode: ctx.readOnly ? 'read-only' : 'write',
    };
    const args = profile.args.map((a) => expandCustomArg(a, customCtx));
    const stdin = profile.stdinBrief === false ? '' : ctx.brief;
    return { args, stdin, finalMode: 'generic' };
  }

  fail(`unsupported adapter: ${adapter}`);
}

function extractOpenCodeFinal(stdout) {
  let sessionId = null;
  let lastText = '';
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      sessionId = e.sessionID ?? e.sessionId ?? e.session_id ?? e.session?.id ?? sessionId;
      const candidates = [
        e.text,
        e.content,
        e.message?.content,
        e.part?.text,
        e.data?.text,
        e.result,
      ];
      for (const c of candidates) if (typeof c === 'string' && c.trim()) lastText = c;
    } catch {}
  }
  return { finalMessage: lastText || tail(stdout || ''), sessionId };
}

function extractFinal(invocation, outcome, run) {
  if (invocation.finalMode === 'claude-json') {
    const parsed = parseJsonBestEffort(outcome.stdout || '');
    return {
      finalMessage: parsed?.result ?? parsed?.final_message ?? parsed?.finalMessage ?? tail(outcome.stdout || ''),
      sessionId: parsed?.session_id ?? parsed?.sessionId ?? parsed?.session?.id ?? null,
      threadId: null,
    };
  }

  if (invocation.finalMode === 'final-file-codex-events') {
    let threadId = null;
    for (const line of String(outcome.stdout || '').split(/\r?\n/)) {
      try {
        const e = JSON.parse(line);
        threadId = e.thread_id ?? e.threadId ?? e.thread?.id ?? threadId;
      } catch {}
    }
    const finalMessage = existsSync(run.finalPath) ? readFileSync(run.finalPath, 'utf8') : tail(outcome.stdout || '');
    return { finalMessage, sessionId: null, threadId };
  }

  if (invocation.finalMode === 'opencode-json-events') {
    const r = extractOpenCodeFinal(outcome.stdout || '');
    return { finalMessage: r.finalMessage, sessionId: r.sessionId, threadId: null };
  }

  const parsed = parseJsonBestEffort(outcome.stdout || '');
  return {
    finalMessage: parsed?.result ?? parsed?.final_message ?? parsed?.finalMessage ?? tail(outcome.stdout || ''),
    sessionId: parsed?.session_id ?? parsed?.sessionId ?? null,
    threadId: parsed?.thread_id ?? parsed?.threadId ?? null,
  };
}

const opts = parse(process.argv.slice(2));
const brief = readBrief(opts.brief);
const { role, profile, readOnly, configMeta } = mergeProfile(opts);
const adapter = profile.adapter;
const run = prepareRunDir(`${role}-${profile.id || adapter}`, opts.cd, opts.outDir);
writeFileSync(run.briefPath, brief, 'utf8');
const before = await gitStatus(opts.cd);
const startedAt = new Date().toISOString();

const ctx = {
  brief,
  briefPath: run.briefPath,
  finalPath: run.finalPath,
  workdir: opts.cd,
  readOnly,
};
const invocation = buildInvocation(adapter, profile, ctx, opts);
const outcome = await runCommand({
  command: profile.command,
  args: invocation.args,
  cwd: opts.cd,
  stdin: invocation.stdin,
  shell: profile.shell,
  timeoutMs: parseDuration(opts.timeout),
});

writeFileSync(run.stdoutPath, outcome.stdout || '', 'utf8');
writeFileSync(run.stderrPath, outcome.stderr || String(outcome.launchError?.message || ''), 'utf8');
const after = await gitStatus(opts.cd);
const touchedFiles = changedPaths(before, after);
const readOnlyViolation = readOnly && touchedFiles != null ? touchedFiles.length > 0 : false;
const extracted = extractFinal(invocation, outcome, run);
if (extracted.finalMessage && !existsSync(run.finalPath)) writeFileSync(run.finalPath, String(extracted.finalMessage), 'utf8');

const status = outcome.launchError
  ? 'unavailable'
  : outcome.timedOut
    ? 'timeout'
    : outcome.code === 0 && !readOnlyViolation
      ? 'completed'
      : 'failed';

const result = {
  schema: 'speckit-orchestrator.run.v2',
  role,
  profileId: profile.id || null,
  adapter,
  status,
  command: profile.command,
  shell: profile.shell,
  model: profile.model ?? null,
  effort: profile.effort ?? null,
  agent: profile.agent ?? null,
  variant: profile.variant ?? null,
  readOnly,
  readOnlyViolation,
  sessionId: extracted.sessionId ?? null,
  threadId: extracted.threadId ?? null,
  workdir: opts.cd,
  startedAt,
  finishedAt: new Date().toISOString(),
  exitCode: outcome.code ?? null,
  signal: outcome.signal ?? null,
  initialDirty: before ? before.length > 0 : null,
  touchedFiles,
  finalMessage: extracted.finalMessage ? String(extracted.finalMessage) : '',
  config: configMeta,
  briefPath: run.briefPath,
  stdoutPath: run.stdoutPath,
  stderrPath: run.stderrPath,
  finalPath: existsSync(run.finalPath) ? run.finalPath : null,
  resultPath: run.resultPath,
  outDir: run.outDir,
};
writeJsonAtomic(run.resultPath, result);
process.stdout.write(`${JSON.stringify({ status: result.status, resultPath: run.resultPath, profileId: result.profileId, adapter, sessionId: result.sessionId, threadId: result.threadId, touchedFiles, readOnlyViolation }, null, 2)}\n`);
process.exit(outcome.launchError ? 127 : outcome.timedOut ? 124 : status === 'completed' ? 0 : outcome.code || 1);
