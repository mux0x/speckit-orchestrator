import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const ADAPTERS = ['claude', 'codex', 'opencode', 'custom'];

export const DEFAULT = {
  version: 2,
  advisor: {
    id: 'terra',
    adapter: 'codex',
    command: 'codex',
    shell: 'auto',
    model: 'gpt-5.6-terra',
    effort: 'high',
    enabled: true,
  },
  workers: [
    {
      id: 'claude-main',
      adapter: 'claude',
      command: 'claude',
      shell: 'auto',
      model: 'claude-opus-5',
      effort: 'medium',
      enabled: true,
    },
    {
      id: 'claude-x',
      adapter: 'claude',
      command: 'claude-x',
      shell: 'auto',
      model: 'claude-opus-5',
      effort: 'medium',
      enabled: true,
    },
  ],
  execution: {
    workspaceMode: 'worktree',
    maxParallel: 'auto',
    finalAdvisorAudit: true,
  },
};

export function inferAdapter(command) {
  const base = String(command || '').split('/').pop()?.toLowerCase() || '';
  if (base === 'claude' || base.startsWith('claude-') || base.startsWith('claude_')) return 'claude';
  if (base === 'codex' || base.startsWith('codex-') || base.startsWith('codex_')) return 'codex';
  if (base === 'opencode' || base === 'opencode2' || base.startsWith('opencode-') || base.startsWith('opencode_')) return 'opencode';
  return null;
}

export function defaultsForAdapter(adapter, role = 'worker') {
  if (adapter === 'claude') return role === 'advisor'
    ? { model: 'claude-opus-5', effort: 'high' }
    : { model: 'claude-opus-5', effort: 'medium' };
  if (adapter === 'codex') return role === 'advisor'
    ? { model: null, effort: 'high' }
    : { model: null, effort: null };
  if (adapter === 'opencode') return role === 'advisor'
    ? { model: null, effort: 'high', agent: 'plan' }
    : { model: null, effort: null, agent: 'build' };
  return { model: null, effort: null };
}

export function gitRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return resolve(cwd);
  }
}

export function globalPath() {
  return join(homedir(), '.config', 'speckit-orchestrator', 'config.json');
}

export function projectPath(cwd) {
  return join(gitRoot(cwd), '.speckit-orchestrator.json');
}

export function targetPath(scope, cwd) {
  if (scope === 'global') return globalPath();
  if (scope === 'project') return projectPath(cwd);
  throw new Error('--scope must be global or project');
}

export function parseJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeProfile(profile, role, fallbackAdapter = null) {
  const p = { ...(profile || {}) };
  p.adapter = p.adapter || inferAdapter(p.command) || fallbackAdapter || 'custom';
  p.shell = p.shell || 'auto';
  if (p.enabled === undefined) p.enabled = true;
  if (role === 'advisor' && p.adapter === 'opencode' && !p.agent) p.agent = 'plan';
  if (role === 'worker' && p.adapter === 'opencode' && !p.agent) p.agent = 'build';
  return p;
}

export function normalizeConfig(input) {
  const raw = structuredClone(input || {});
  let config;

  if (raw.version === 1 || raw.reviewer) {
    const reviewer = raw.reviewer || DEFAULT.advisor;
    config = {
      version: 2,
      advisor: normalizeProfile({ ...reviewer, adapter: reviewer.adapter || inferAdapter(reviewer.command) || 'codex' }, 'advisor', 'codex'),
      workers: (raw.workers || []).map((w) => normalizeProfile({ ...w, adapter: w.adapter || inferAdapter(w.command) || 'claude' }, 'worker', 'claude')),
      execution: {
        ...(raw.execution || {}),
        finalAdvisorAudit: true,
      },
    };
    delete config.execution.finalTerraAudit;
  } else {
    config = {
      version: 2,
      advisor: normalizeProfile(raw.advisor || DEFAULT.advisor, 'advisor', 'codex'),
      workers: (raw.workers || DEFAULT.workers).map((w) => normalizeProfile(w, 'worker')),
      execution: { ...(raw.execution || DEFAULT.execution), finalAdvisorAudit: true },
    };
  }

  config.execution.workspaceMode ||= 'worktree';
  if (config.execution.maxParallel === undefined) config.execution.maxParallel = 'auto';
  config.execution.finalAdvisorAudit = true;
  return config;
}

function validateProfile(profile, label) {
  const errors = [];
  if (!profile || typeof profile !== 'object') return [`${label} must be an object`];
  if (!profile.id || typeof profile.id !== 'string') errors.push(`${label}.id is required`);
  if (!profile.command || typeof profile.command !== 'string') errors.push(`${label}.command is required`);
  if (!ADAPTERS.includes(profile.adapter)) errors.push(`${label}.adapter must be ${ADAPTERS.join('|')}`);
  if (profile.shell && !['auto', 'always', 'never'].includes(profile.shell)) errors.push(`${label}.shell must be auto|always|never`);
  if (profile.model !== undefined && profile.model !== null && typeof profile.model !== 'string') errors.push(`${label}.model must be a string or null`);
  if (profile.effort !== undefined && profile.effort !== null && typeof profile.effort !== 'string') errors.push(`${label}.effort must be a string or null`);
  if (profile.agent !== undefined && profile.agent !== null && typeof profile.agent !== 'string') errors.push(`${label}.agent must be a string or null`);
  if (profile.variant !== undefined && profile.variant !== null && typeof profile.variant !== 'string') errors.push(`${label}.variant must be a string or null`);
  if (profile.adapter === 'custom') {
    if (!Array.isArray(profile.args)) errors.push(`${label}.args must be an array for custom adapter`);
    else if (profile.args.some((x) => typeof x !== 'string')) errors.push(`${label}.args must contain only strings`);
    if (profile.stdinBrief !== undefined && typeof profile.stdinBrief !== 'boolean') errors.push(`${label}.stdinBrief must be boolean`);
  }
  return errors;
}

export function validateConfig(input) {
  const config = normalizeConfig(input);
  const errors = [];
  if (config.version !== 2) errors.push('version must be 2');
  errors.push(...validateProfile(config.advisor, 'advisor'));
  if (!Array.isArray(config.workers) || config.workers.length < 1) errors.push('workers must contain at least one worker');
  const ids = new Set();
  for (const [i, w] of (config.workers || []).entries()) {
    errors.push(...validateProfile(w, `workers[${i}]`));
    if (w?.id) {
      if (ids.has(w.id)) errors.push(`duplicate worker id: ${w.id}`);
      ids.add(w.id);
    }
  }
  if (!['worktree', 'shared'].includes(config.execution?.workspaceMode)) errors.push('execution.workspaceMode must be worktree|shared');
  const mp = config.execution?.maxParallel;
  if (mp !== 'auto' && !(Number.isInteger(mp) && mp > 0)) errors.push('execution.maxParallel must be auto or a positive integer');
  if (config.execution?.finalAdvisorAudit !== true) errors.push('execution.finalAdvisorAudit must be true');
  return errors;
}

export function effectiveConfig(cwd) {
  const pp = projectPath(cwd);
  const gp = globalPath();
  if (existsSync(pp)) return { source: 'project', path: pp, config: normalizeConfig(parseJson(pp)) };
  if (existsSync(gp)) return { source: 'global', path: gp, config: normalizeConfig(parseJson(gp)) };
  return { source: 'defaults', path: null, config: normalizeConfig(DEFAULT) };
}

export function writeConfig(path, input) {
  const config = normalizeConfig(input);
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`invalid config:\n- ${errors.join('\n- ')}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

export function resolveProfile(config, selector) {
  if (selector === 'advisor') {
    if (!config.advisor?.enabled) throw new Error('advisor is disabled');
    return { role: 'advisor', profile: config.advisor };
  }
  if (selector.startsWith('worker:')) {
    const id = selector.slice('worker:'.length);
    const profile = config.workers.find((w) => w.id === id);
    if (!profile) throw new Error(`worker not found: ${id}`);
    if (!profile.enabled) throw new Error(`worker is disabled: ${id}`);
    return { role: 'worker', profile };
  }
  throw new Error('--profile must be advisor or worker:<id>');
}
