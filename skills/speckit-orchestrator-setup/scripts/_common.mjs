import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export function fail(message, code = 2) {
  process.stderr.write(`speckit-orchestrator: ${message}\n`);
  process.exit(code);
}

export function readBrief(path) {
  if (path) {
    if (!existsSync(path)) fail(`brief file not found: ${path}`);
    return readFileSync(path, 'utf8');
  }
  if (process.stdin.isTTY) fail('pass --brief <file> or pipe a brief on stdin');
  return readFileSync(0, 'utf8');
}

export function parseDuration(value) {
  if (value == null) return null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const ms = ((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)) * 1000;
  if (!Number.isSafeInteger(ms) || ms <= 0) return null;
  return ms;
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function prepareRunDir(tool, cwd, outDir) {
  const dir = outDir
    ? resolve(outDir)
    : join(tmpdir(), 'speckit-orchestrator', `${basename(cwd) || 'repo'}-${tool}-${timestamp()}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return {
    outDir: dir,
    stdoutPath: join(dir, 'stdout.txt'),
    stderrPath: join(dir, 'stderr.txt'),
    resultPath: join(dir, 'result.json'),
    finalPath: join(dir, 'final.txt'),
    briefPath: join(dir, 'brief.txt'),
  };
}

export function writeJsonAtomic(path, obj) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function gitStatus(cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn('git', ['status', '--porcelain=v1', '-z'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => resolvePromise(null));
    child.on('close', (code) => {
      if (code !== 0) return resolvePromise(null);
      const entries = out.split('\0').filter(Boolean).map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
      resolvePromise(entries);
    });
  });
}

export function changedPaths(before, after) {
  if (after == null) return null;
  if (before == null) return [...new Set(after.map((x) => x.path))].sort();
  const b = new Map(before.map((x) => [x.path, x.status]));
  const changed = [];
  for (const entry of after) {
    if (!b.has(entry.path) || b.get(entry.path) !== entry.status) changed.push(entry.path);
  }
  return [...new Set(changed)].sort();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function safeAlias(command) {
  return /^[A-Za-z0-9_.-]+$/.test(command);
}

function pickShell() {
  return process.env.SHELL || '/bin/zsh';
}

function launchOnce({ command, args, cwd, stdin, shellMode, timeoutMs }) {
  return new Promise((resolvePromise) => {
    let child;
    if (shellMode === 'always') {
      if (!safeAlias(command)) {
        resolvePromise({ launchError: new Error('shell mode requires a bare safe command/alias token; use --shell never for an executable path') });
        return;
      }
      const shell = pickShell();
      const line = [command, ...args.map(shellQuote)].join(' ');
      child = spawn(shell, ['-ic', line], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    } else {
      child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ launchError: error, stdout, stderr, timedOut });
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr, timedOut });
    });

    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000).unref();
      }, timeoutMs);
    }

    // Some CLIs (especially --version/--help probes) exit before consuming stdin.
    // Ignore EPIPE on stdin because the process result still determines success/failure.
    child.stdin.on('error', (error) => {
      if (error?.code !== 'EPIPE') {
        // Non-EPIPE stdin errors are reflected in stderr for diagnostics but do not
        // replace the actual child exit result.
        stderr += `\n[stdin error] ${error.message}`;
      }
    });
    child.stdin.end(stdin);
  });
}

export async function runCommand({ command, args, cwd, stdin, shell = 'auto', timeoutMs = null }) {
  if (!['auto', 'always', 'never'].includes(shell)) throw new Error(`invalid shell mode: ${shell}`);
  if (shell === 'always') return launchOnce({ command, args, cwd, stdin, shellMode: 'always', timeoutMs });
  const direct = await launchOnce({ command, args, cwd, stdin, shellMode: 'never', timeoutMs });
  if (shell === 'auto' && direct.launchError && direct.launchError.code === 'ENOENT') {
    return launchOnce({ command, args, cwd, stdin, shellMode: 'always', timeoutMs });
  }
  return direct;
}

export function parseJsonBestEffort(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const lines = trimmed.split(/\r?\n/).reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch {}
  }
  return null;
}

export function tail(text, max = 12000) {
  return text.length <= max ? text : text.slice(-max);
}
