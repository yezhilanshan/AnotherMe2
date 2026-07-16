import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const rootDir = process.cwd();
const engineDir = path.join(rootDir, 'anotherme2_engine');
const comspec = process.env.ComSpec || 'cmd.exe';
const uvCmd = process.env.ANOTHERME2_UV_CMD || 'uv';
const nextDevLockPath = path.join(rootDir, '.next', 'dev', 'lock');

const dockerComposeFile = path.resolve(rootDir, '..', 'docker-compose.unified.yml');

const INFRA_CONTAINERS = [
  { containerName: 'anotherme-postgres', serviceName: 'postgres' },
  { containerName: 'anotherme-redis', serviceName: 'redis' },
  { containerName: 'anotherme-minio', serviceName: 'minio' },
];

const children = new Map();
let shuttingDown = false;
const serviceBuffers = new Map();
const ignoredExitServices = new Set();

function parseGatewayBaseUrl() {
  const envValue = process.env.ANOTHERME2_GATEWAY_BASE_URL?.trim();
  if (envValue) {
    return new URL(envValue);
  }

  const envFile = path.join(rootDir, '.env.local');
  if (fs.existsSync(envFile)) {
    const line = fs
      .readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((item) => item.startsWith('ANOTHERME2_GATEWAY_BASE_URL='));
    if (line) {
      const raw = line
        .split('=', 2)[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, '');
      if (raw) {
        return new URL(raw);
      }
    }
  }

  return new URL('http://127.0.0.1:8080');
}

function parsePythonVersion(text) {
  const match = text.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function probePython(cmd, args) {
  const result = spawnSync(cmd, [...args, '--version'], { encoding: 'utf8' });
  if (result.error) return null;
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return parsePythonVersion(output);
}

function isPreferredPythonVersion(version) {
  return version?.major === 3 && version.minor >= 11 && version.minor <= 12;
}

function pythonVersionRequest(version) {
  if (!version) return null;
  return `${version.major}.${version.minor}`;
}

function parseWindowsPythonLauncherCommand(command) {
  const match = command.match(/^py(?:\.exe)?\s+-(3(?:\.\d+)?)$/i);
  if (!match) return null;
  return match[1];
}

function resolvePythonCommand() {
  const envValue = process.env.ANOTHERME2_PYTHON_CMD?.trim();
  if (envValue) {
    const launcherRequest = isWindows ? parseWindowsPythonLauncherCommand(envValue) : null;
    if (launcherRequest) {
      const version = probePython('py', [`-${launcherRequest}`]);
      return {
        label: envValue,
        uvPython: launcherRequest,
        version,
      };
    }

    const version = probePython(envValue, []);
    return {
      label: envValue,
      uvPython: envValue,
      version,
    };
  }

  const candidates = isWindows
    ? [
        { label: 'py -3.12', cmd: 'py', args: ['-3.12'], uvPython: '3.12' },
        { label: 'py -3.11', cmd: 'py', args: ['-3.11'], uvPython: '3.11' },
        { label: 'python3.12', cmd: 'python3.12', args: [], uvPython: '3.12' },
        { label: 'python3.11', cmd: 'python3.11', args: [], uvPython: '3.11' },
        { label: 'python', cmd: 'python', args: [], uvPython: null },
      ]
    : [
        { label: 'python3.12', cmd: 'python3.12', args: [], uvPython: '3.12' },
        { label: 'python3.11', cmd: 'python3.11', args: [], uvPython: '3.11' },
        { label: 'python3', cmd: 'python3', args: [], uvPython: null },
        { label: 'python', cmd: 'python', args: [], uvPython: null },
      ];

  let fallback = null;
  for (const candidate of candidates) {
    const version = probePython(candidate.cmd, candidate.args);
    if (!version) continue;
    const resolved = {
      label: candidate.label,
      uvPython: candidate.uvPython ?? pythonVersionRequest(version),
      version,
    };
    if (!fallback) {
      fallback = resolved;
    }
    if (isPreferredPythonVersion(version)) {
      return resolved;
    }
  }

  return fallback ?? { label: 'python', uvPython: null, version: null };
}

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickGatewayUrl() {
  const parsed = parseGatewayBaseUrl();
  const hostname = parsed.hostname || '127.0.0.1';
  const protocol = parsed.protocol || 'http:';
  const pathname = parsed.pathname || '';
  const basePort = parsed.port ? Number(parsed.port) : 8080;

  for (let candidate = basePort; candidate < basePort + 20; candidate += 1) {
    // Probe on 0.0.0.0 semantics by checking all interfaces.
    const canBindAny = await isPortAvailable(candidate, '0.0.0.0');
    if (!canBindAny) continue;
    return `${protocol}//${hostname}:${candidate}${pathname}`.replace(/\/$/, '');
  }

  throw new Error(`No available port found for AnotherMe2 gateway starting from ${basePort}`);
}

function prefixOutput(name, chunk, stream = process.stdout) {
  const text = String(chunk);
  const prev = serviceBuffers.get(name) || '';
  serviceBuffers.set(name, `${prev}${text}`.slice(-12000));
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    stream.write(`[${name}] ${line}\n`);
  }
}

function killProcessOnPort(port) {
  let pid = null;
  if (isWindows) {
    const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    if (result.error || !result.stdout) return;
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = line.trim().match(new RegExp(`:${port}\\s+.*?LISTENING\\s+(\\d+)`));
      if (match) {
        pid = match[1];
        break;
      }
    }
  } else {
    const result = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
    if (!result.error && result.stdout) {
      pid = result.stdout.trim().split('\n')[0];
    }
  }
  if (pid) {
    spawnSync(isWindows ? 'taskkill' : 'kill', isWindows ? ['/F', '/PID', pid] : ['-9', pid], {
      encoding: 'utf8',
    });
    process.stdout.write(`[dev-all] Killed old process on port ${port} (PID: ${pid}).\n`);
  }
}

function cleanupOldProcesses() {
  if (process.env.ANOTHERME2_SKIP_CLEANUP) {
    return;
  }

  killProcessOnPort(3000);
  killProcessOnPort(8080);

  if (fs.existsSync(nextDevLockPath)) {
    try {
      fs.rmSync(nextDevLockPath, { force: true });
      process.stdout.write('[dev-all] Removed stale Next.js dev lock.\n');
    } catch {
      // Ignore errors during cleanup
    }
  }
}

function isDockerAvailable() {
  const result = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  return !result.error;
}

function getContainerStates() {
  const result = spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.State}}'], {
    encoding: 'utf8',
  });
  if (result.error) return new Map();
  const states = new Map();
  for (const line of result.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const [name, state] = line.split('\t');
    if (name) states.set(name, state);
  }
  return states;
}

async function waitForContainerHealthy(containerName, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const result = spawnSync(
        'docker',
        ['ps', '--filter', `name=^${containerName}$`, '--format', '{{.Status}}'],
        { encoding: 'utf8' },
      );
      const status = result.stdout?.trim() || '';
      if (status.includes('(healthy)') || status.includes('(Healthy)')) {
        process.stdout.write(`[dev-all] Container ${containerName} is healthy.\n`);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        process.stdout.write(
          `[dev-all] Warning: ${containerName} did not become healthy within ${timeoutMs / 1000}s, proceeding anyway.\n`,
        );
        resolve();
      } else {
        setTimeout(check, 2000);
      }
    };
    check();
  });
}

async function ensureInfraContainers() {
  if (process.env.ANOTHERME2_SKIP_DOCKER) {
    process.stdout.write(
      '[dev-all] Skipping Docker container startup (ANOTHERME2_SKIP_DOCKER is set).\n',
    );
    return;
  }

  if (!isDockerAvailable()) {
    process.stdout.write('[dev-all] Docker not available. Skipping container startup.\n');
    return;
  }

  if (!fs.existsSync(dockerComposeFile)) {
    process.stdout.write(
      `[dev-all] docker-compose file not found at ${dockerComposeFile}. Skipping.\n`,
    );
    return;
  }

  const states = getContainerStates();
  const toStart = [];

  for (const { containerName, serviceName } of INFRA_CONTAINERS) {
    const state = states.get(containerName);
    if (!state) {
      process.stdout.write(`[dev-all] Container ${containerName} does not exist, will create.\n`);
      toStart.push(serviceName);
    } else if (state !== 'running') {
      process.stdout.write(`[dev-all] Container ${containerName} is ${state}, will restart.\n`);
      toStart.push(serviceName);
    } else {
      process.stdout.write(`[dev-all] Container ${containerName} already running.\n`);
    }
  }

  if (toStart.length === 0) {
    process.stdout.write('[dev-all] All infrastructure containers already running.\n');
    return;
  }

  process.stdout.write(`[dev-all] Starting Docker infrastructure: ${toStart.join(', ')}\n`);

  // Include minio-init whenever minio is being started (it creates the bucket)
  const services = [...toStart];
  if (toStart.includes('minio') && !services.includes('minio-init')) {
    services.push('minio-init');
  }

  const result = spawnSync(
    'docker',
    ['compose', '-f', dockerComposeFile, 'up', '-d', ...services],
    {
      encoding: 'utf8',
      stdio: 'inherit',
      cwd: rootDir,
    },
  );

  if (result.error || result.status !== 0) {
    process.stdout.write(
      '[dev-all] Failed to start Docker containers. ' +
        'Please start them manually or set ANOTHERME2_SKIP_DOCKER=1.\n',
    );
    return;
  }

  // Wait for Postgres and Redis health checks before proceeding
  process.stdout.write('[dev-all] Waiting for containers to become healthy...\n');
  await waitForContainerHealthy('anotherme-postgres');
  await waitForContainerHealthy('anotherme-redis');
  process.stdout.write('[dev-all] Infrastructure containers ready.\n');
}

function shouldIgnoreServiceExit(serviceName, code) {
  if (serviceName !== 'anotherme' || code === 0) {
    return false;
  }
  const output = serviceBuffers.get(serviceName) || '';
  return output.includes('Unable to acquire lock') && output.includes('.next\\dev\\lock');
}

function killChild(child, signal) {
  try {
    if (!child.killed) {
      child.kill(signal);
    }
  } catch {}
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    killChild(child, 'SIGTERM');
  }
  setTimeout(() => {
    for (const child of children.values()) {
      killChild(child, 'SIGKILL');
    }
    process.exit(exitCode);
  }, 1000).unref();
}

async function main() {
  cleanupOldProcesses();
  await ensureInfraContainers();

  const gatewayUrl = await pickGatewayUrl();
  const gatewayPort = new URL(gatewayUrl).port || '8080';
  const pythonCommand = resolvePythonCommand();
  const condaEnv = process.env.ANOTHERME2_CONDA_ENV || 'AnotherMe-V2';
  const queueBackend = process.env.GATEWAY_QUEUE_BACKEND || 'polling';

  process.stdout.write(`[dev-all] AnotherMe2 conda env: ${condaEnv}\n`);
  if (!process.env.GATEWAY_QUEUE_BACKEND) {
    process.stdout.write('[dev-all] AnotherMe2 queue backend: polling\n');
  }

  if (isWindows && pythonCommand.version) {
    const { major, minor } = pythonCommand.version;
    if (major === 3 && minor >= 13) {
      process.stdout.write(
        '[dev-all] Warning: Python 3.13+ on Windows may fail to build Manim dependencies. ' +
          'Install Python 3.11/3.12 or set ANOTHERME2_PYTHON_CMD to a 3.11/3.12 interpreter.\n',
      );
    }
  }

  const sharedEnv = {
    ...process.env,
    ANOTHERME2_GATEWAY_BASE_URL: gatewayUrl,
    GATEWAY_PORT: gatewayPort,
    GATEWAY_QUEUE_BACKEND: queueBackend,
    CLASSROOM_DATA_DIR: path.join(rootDir, 'data', 'classrooms'),
  };

  const pythonExe =
    process.env.ANOTHERME2_PYTHON_CMD ||
    (isWindows ? 'C:\\User\\anaconda\\envs\\AnotherMe-V2\\python.exe' : 'python3');
  const services = [
    {
      name: 'anotherme2-gateway',
      cwd: rootDir,
      runner: 'direct',
      command: pythonExe,
      args: [path.join(engineDir, 'run_gateway.py')],
      env: sharedEnv,
    },
    {
      name: 'anotherme2-worker',
      cwd: rootDir,
      runner: 'direct',
      command: pythonExe,
      args: [path.join(engineDir, 'run_gateway_worker.py')],
      env: sharedEnv,
    },
  ];

  if (fs.existsSync(nextDevLockPath)) {
    process.stdout.write(
      '[dev-all] Detected existing Next dev lock, reusing the running AnotherMe dev server.\n',
    );
    ignoredExitServices.add('anotherme');
  } else {
    services.unshift({
      name: 'anotherme',
      cwd: rootDir,
      runner: 'pnpm',
      command: 'pnpm dev',
      env: sharedEnv,
    });
  }

  for (const service of services) {
    const child =
      service.runner === 'pnpm'
        ? isWindows
          ? spawn(comspec, ['/d', '/s', '/c', service.command], {
              cwd: service.cwd,
              env: service.env,
              stdio: ['inherit', 'pipe', 'pipe'],
              windowsHide: false,
            })
          : spawn('pnpm', ['dev'], {
              cwd: service.cwd,
              env: service.env,
              stdio: ['inherit', 'pipe', 'pipe'],
              shell: false,
            })
        : service.runner === 'conda'
          ? spawn('conda', service.args, {
              cwd: service.cwd,
              env: service.env,
              stdio: ['inherit', 'pipe', 'pipe'],
              shell: false,
            })
          : service.runner === 'direct'
            ? spawn(service.command, service.args, {
                cwd: service.cwd,
                env: service.env,
                stdio: ['inherit', 'pipe', 'pipe'],
                shell: false,
              })
            : spawn(uvCmd, service.args, {
                cwd: service.cwd,
                env: service.env,
                stdio: ['inherit', 'pipe', 'pipe'],
                shell: false,
              });

    children.set(service.name, child);
    child.stdout.on('data', (chunk) => prefixOutput(service.name, chunk));
    child.stderr.on('data', (chunk) => prefixOutput(service.name, chunk, process.stderr));
    child.on('exit', (code) => {
      if (shuttingDown) return;
      const normalized = typeof code === 'number' ? code : 1;
      if (
        ignoredExitServices.has(service.name) ||
        shouldIgnoreServiceExit(service.name, normalized)
      ) {
        process.stdout.write(`[dev-all] Reusing existing ${service.name} instance.\n`);
        return;
      }
      process.stderr.write(`[${service.name}] exited with code ${normalized}\n`);
      shutdown(normalized);
    });
    child.on('error', (error) => {
      if (shuttingDown) return;
      process.stderr.write(`[${service.name}] failed to start: ${error.message}\n`);
      shutdown(1);
    });
  }
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((error) => {
  process.stderr.write(`[dev-all] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
