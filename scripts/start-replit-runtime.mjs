import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const runtimeCommands = [
  { name: 'api', args: ['run', 'start:api'] },
  { name: 'finalize-worker', args: ['run', 'start:worker:finalize'] },
];

const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function spawnRuntimeProcess(args) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', `${npmCommand} ${args.join(' ')}`], {
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    });
  }

  return spawn(npmCommand, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  });
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {}
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {}
}

function shutdown(reason, code = 0) {
  if (code !== 0) exitCode = code;
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[replit-run] stopping split runtime', { reason, exitCode });
  for (const child of children.values()) terminateChild(child);
  setTimeout(() => {
    for (const child of children.values()) terminateChild(child);
    process.exit(exitCode);
  }, 5000).unref();
  if (children.size === 0) process.exit(exitCode);
}

console.log('[replit-run] starting split runtime', {
  api: 'npm run start:api',
  worker: 'npm run start:worker:finalize',
});

for (const runtime of runtimeCommands) {
  const child = spawnRuntimeProcess(runtime.args);
  children.set(runtime.name, child);

  child.on('error', (error) => {
    console.error('[replit-run] child process failed to start', {
      runtime: runtime.name,
      message: error?.message ?? String(error),
    });
    shutdown(`${runtime.name}_spawn_error`, 1);
  });

  child.on('exit', (code, signal) => {
    children.delete(runtime.name);
    if (shuttingDown) {
      if (children.size === 0) process.exit(exitCode);
      return;
    }

    console.error('[replit-run] child process exited', {
      runtime: runtime.name,
      code,
      signal,
    });
    shutdown(`${runtime.name}_exit`, code === 0 ? 1 : code ?? 1);
  });
}

process.on('SIGINT', () => shutdown('sigint', 0));
process.on('SIGTERM', () => shutdown('sigterm', 0));
process.on('exit', () => {
  for (const child of children.values()) terminateChild(child);
});
