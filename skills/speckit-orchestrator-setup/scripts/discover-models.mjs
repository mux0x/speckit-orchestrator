#!/usr/bin/env node
import { resolve } from 'node:path';
import { inferAdapter } from './_config.mjs';
import { runCommand } from './_common.mjs';

function parse(argv) {
  const out = {
    cwd: process.cwd(),
    command: null,
    adapter: null,
    role: 'worker',
    shell: 'auto',
    model: null,
    timeoutMs: 12000,
    refresh: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cwd') out.cwd = resolve(argv[++i]);
    else if (a === '--command') out.command = argv[++i];
    else if (a === '--adapter') out.adapter = argv[++i];
    else if (a === '--role') out.role = argv[++i];
    else if (a === '--shell') out.shell = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (a === '--refresh') out.refresh = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write('Usage: discover-models.mjs --command CMD [--adapter claude|codex|opencode|custom] [--role advisor|worker] [--model MODEL] [--cwd DIR] [--shell auto|always|never] [--refresh]\n');
      process.exit(0);
    } else throw new Error(`unknown option: ${a}`);
  }
  if (!out.command) throw new Error('--command is required');
  if (!['advisor', 'worker'].includes(out.role)) throw new Error('--role must be advisor or worker');
  out.adapter ||= inferAdapter(out.command) || 'custom';
  return out;
}

const ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const clean = (s) => String(s || '').replace(ANSI, '').trim();
const firstLine = (s) => clean(s).split(/\r?\n/).map((x) => x.trim()).find(Boolean) || null;

function uniqModels(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const id = String(item?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, ...item, id });
  }
  return out;
}

function fallbackModels(adapter) {
  if (adapter === 'claude') {
    return [
      { id: 'opus', label: 'Claude Opus (CLI alias)', source: 'fallback-catalog', verified: false },
      { id: 'sonnet', label: 'Claude Sonnet (CLI alias)', source: 'fallback-catalog', verified: false },
      { id: 'claude-opus-5', label: 'Claude Opus 5', source: 'fallback-catalog', verified: false },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', source: 'fallback-catalog', verified: false },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', source: 'fallback-catalog', verified: false },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', source: 'fallback-catalog', verified: false },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', source: 'fallback-catalog', verified: false },
    ];
  }
  if (adapter === 'codex') {
    return [
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', source: 'fallback-catalog', verified: false },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', source: 'fallback-catalog', verified: false },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', source: 'fallback-catalog', verified: false },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', source: 'fallback-catalog', verified: false },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', source: 'fallback-catalog', verified: false },
    ];
  }
  return [];
}

function defaultModel(adapter, role) {
  if (adapter === 'claude') return 'claude-opus-5';
  if (adapter === 'codex' && role === 'advisor') return 'gpt-5.6-terra';
  return null;
}

function effortInfo(adapter, model, role, liveVariants = []) {
  const m = String(model || '').toLowerCase();
  if (adapter === 'opencode') {
    const live = [...new Set(liveVariants.filter(Boolean))];
    if (live.length) return {
      kind: 'variant',
      source: 'live-cli',
      verified: true,
      options: ['default', ...live],
      default: role === 'advisor' && live.includes('high') ? 'high' : 'default',
      note: 'OpenCode exposes reasoning through model-specific variants. "default" leaves the CLI/provider choice unchanged.',
    };
    const nested = m.split('/').slice(1).join('/');
    const fb = effortInfo(nested.includes('claude') ? 'claude' : nested.includes('gpt-5.3-codex') || nested.includes('gpt-5.2-codex') ? 'codex' : 'custom', nested, role, []);
    if (fb.options?.length > 1) return { ...fb, kind: 'variant', source: 'model-fallback', verified: false, note: 'OpenCode variant metadata was not machine-readable; these are model-family fallbacks. You may enter a custom variant.' };
    return { kind: 'variant', source: 'unknown', verified: false, options: ['default'], default: 'default', note: 'Variant names are model-specific. Use a custom variant if your OpenCode model exposes one.' };
  }

  if (adapter === 'claude') {
    if (m.includes('haiku-4-5')) return {
      kind: 'effort', source: 'model-fallback', verified: false, options: ['default'], default: 'default',
      note: 'Claude Haiku 4.5 does not expose the current effort control. Leave it at CLI default.',
    };
    if (m === 'claude-opus-5' || m === 'opus' || m.includes('opus-5')) return {
      kind: 'effort', source: 'model-fallback', verified: false,
      options: ['default', 'low', 'medium', 'high', 'xhigh', 'max'],
      default: role === 'advisor' ? 'high' : 'medium',
      note: 'Known Claude Opus 5 effort levels. Availability still depends on the installed Claude Code/account.',
    };
    if (m.includes('sonnet-5')) return {
      kind: 'effort', source: 'model-fallback', verified: false,
      options: ['default', 'low', 'medium', 'high'],
      default: role === 'advisor' ? 'high' : 'medium',
      note: 'Conservative Sonnet 5 effort choices. You may enter another CLI-supported effort explicitly.',
    };
    return {
      kind: 'effort', source: 'adapter-fallback', verified: false,
      options: ['default', 'low', 'medium', 'high'],
      default: role === 'advisor' ? 'high' : 'medium',
      note: 'Generic Claude effort choices; exact support is model-dependent. "default" leaves the CLI setting unchanged.',
    };
  }

  if (adapter === 'codex') {
    if (m.includes('gpt-5.3-codex') || m.includes('gpt-5.2-codex')) return {
      kind: 'effort', source: 'model-fallback', verified: false,
      options: ['default', 'low', 'medium', 'high', 'xhigh'],
      default: role === 'advisor' ? 'high' : 'medium',
      note: 'Known Codex-model reasoning levels. The installed CLI/account still determines actual model access.',
    };
    if (m.includes('gpt-5.6-terra') || m.includes('gpt-5.6-sol') || m.includes('gpt-5.6-luna')) return {
      kind: 'effort', source: 'pack-default', verified: false,
      options: ['default', 'medium', 'high'],
      default: role === 'advisor' ? 'high' : 'medium',
      note: 'Pack-safe choices for the configured GPT-5.6 profiles. You may enter another effort if your Codex CLI exposes it.',
    };
    return {
      kind: 'effort', source: 'adapter-fallback', verified: false,
      options: ['default', 'low', 'medium', 'high', 'xhigh'],
      default: role === 'advisor' ? 'high' : 'default',
      note: 'Codex accepts a model_reasoning_effort override, but exact support depends on the selected model. "default" inherits the CLI/profile setting.',
    };
  }

  return { kind: 'effort', source: 'unknown', verified: false, options: ['default'], default: 'default', note: 'No built-in effort catalog for this custom adapter.' };
}

function parseOpenCodeModels(text) {
  const models = [];
  for (const raw of clean(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/(?:^|\s)([A-Za-z0-9._-]+\/[A-Za-z0-9._:@/+\-]+)(?:\s|$)/);
    if (match) models.push({ id: match[1], source: 'live-cli', verified: true });
  }
  return uniqModels(models);
}

function parseVariantsFromVerbose(text, selectedModel) {
  if (!selectedModel) return [];
  const lines = clean(text).split(/\r?\n/);
  const variants = new Set();
  let near = false;
  let budget = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes(selectedModel)) { near = true; budget = 18; }
    else if (budget > 0) budget -= 1;
    else near = false;
    if (!near) continue;
    for (const re of [
      /variants?\s*[:=]\s*\[?([^\]]+)/i,
      /variant\s*[:=]\s*([A-Za-z0-9._-]+)/i,
    ]) {
      const m = line.match(re);
      if (!m) continue;
      for (const token of m[1].split(/[\s,]+/).map((x) => x.replace(/["'{}\[\]]/g, '').trim()).filter(Boolean)) {
        if (/^[A-Za-z0-9._-]+$/.test(token) && !['variant', 'variants'].includes(token.toLowerCase())) variants.add(token);
      }
    }
  }
  return [...variants];
}

async function probe(command, args, opts) {
  return runCommand({ command, args, cwd: opts.cwd, stdin: '', shell: opts.shell, timeoutMs: opts.timeoutMs });
}

const opts = parse(process.argv.slice(2));
const versionResult = await probe(opts.command, ['--version'], opts);
const available = !versionResult.launchError && !versionResult.timedOut && versionResult.code === 0;
let models = [];
let modelDiscovery = { source: 'fallback-catalog', verified: false };
let liveVariants = [];
const notes = [];

if (available && opts.adapter === 'opencode') {
  const args = ['models'];
  if (opts.refresh) args.push('--refresh');
  const r = await probe(opts.command, args, opts);
  if (!r.launchError && !r.timedOut && r.code === 0) {
    const live = parseOpenCodeModels(r.stdout || r.stderr || '');
    if (live.length) {
      models = live;
      modelDiscovery = { source: 'live-cli', verified: true };
    }
  }
  if (opts.model) {
    const vr = await probe(opts.command, ['models', '--verbose'], opts);
    if (!vr.launchError && !vr.timedOut && vr.code === 0) liveVariants = parseVariantsFromVerbose(vr.stdout || vr.stderr || '', opts.model);
  }
}

if (available && (opts.adapter === 'claude' || opts.adapter === 'codex')) {
  const hr = await probe(opts.command, ['--help'], opts);
  if (hr.launchError || hr.timedOut || hr.code !== 0) notes.push('CLI help could not be inspected; using fallback choices.');
  else notes.push(`${opts.adapter} does not provide a documented headless model-list command in this pack; model choices below are fallback/catalog choices unless the CLI itself exposes more.`);
}

if (!models.length) models = fallbackModels(opts.adapter);
models = uniqModels(models);

const selected = opts.model && opts.model !== 'default' && opts.model !== 'null' ? opts.model : null;
const effort = effortInfo(opts.adapter, selected, opts.role, liveVariants);

process.stdout.write(`${JSON.stringify({
  ok: available,
  command: opts.command,
  adapter: opts.adapter,
  role: opts.role,
  commandAvailable: available,
  version: firstLine(versionResult.stdout) || firstLine(versionResult.stderr),
  modelDiscovery,
  models,
  defaultModel: defaultModel(opts.adapter, opts.role),
  allowCliDefaultModel: true,
  allowCustomModel: true,
  selectedModel: selected,
  effort,
  notes,
}, null, 2)}\n`);
