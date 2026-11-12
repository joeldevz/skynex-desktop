import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpdateCommand } from './commands-update.js';

describe('skynex-app update command', () => {
  let originalWrite;
  let originalFetch;
  let originalTtyDescriptor;
  let previousDataDir;
  let appDataDir;
  let output;
  let fetchCalls;
  let children = [];
  let activeChild;

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-update-command-'));
    previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
    process.env.OPENCHAMBER_DATA_DIR = appDataDir;
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = async (url) => {
      const requestUrl = String(url);
      fetchCalls.push(requestUrl);
      const target = new URL(requestUrl);
      if (target.pathname === '/api/system/info') {
        return { ok: true, json: async () => ({ runtime: 'web', pid: activeChild?.pid }) };
      }
      if (target.pathname === '/api/system/shutdown') return { ok: true };
      throw new Error(`unexpected local request: ${requestUrl}`);
    };
    originalTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
  });

  afterEach(async () => {
    if (originalWrite) process.stdout.write = originalWrite;
    if (originalTtyDescriptor) Object.defineProperty(process.stdout, 'isTTY', originalTtyDescriptor);
    else delete process.stdout.isTTY;
    globalThis.fetch = originalFetch;
    if (previousDataDir === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
    else process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    }
    children = [];
    activeChild = undefined;
    if (appDataDir) fs.rmSync(appDataDir, { recursive: true, force: true });
    appDataDir = undefined;
    output = undefined;
  });

  function captureStdout() {
    originalWrite = process.stdout.write;
    output = '';
    process.stdout.write = (chunk) => {
      output += String(chunk);
      return true;
    };
  }

  function makeCommand({ managed = true, available = true, updateResult = { success: true }, currentVersion = '1.2.2' } = {}) {
    let serveCalls = 0;
    const isManagedInstall = vi.fn(() => managed);
    const checkForUpdates = vi.fn(async () => ({
      available,
      version: available ? '1.2.3' : currentVersion,
      currentVersion,
      releaseUrl: 'https://github.com/joeldevz/skynex-desktop/releases/tag/v1.2.3',
    }));
    const executeUpdate = vi.fn(async () => updateResult);
    const serveCommand = () => { serveCalls += 1; };
    const importFromFilePath = async () => ({
      isManagedInstall,
      checkForUpdates,
      detectPackageManager: () => 'npm',
      executeUpdate,
      getCurrentVersion: () => currentVersion,
    });
    const updateCommand = createUpdateCommand({
      packageManagerPath: '/fake/package-manager.js',
      serveCommand,
      importFromFilePath,
    });
    return { updateCommand, isManagedInstall, checkForUpdates, executeUpdate, get serveCalls() { return serveCalls; } };
  }

  it('refuses an unmanaged/source install before fetch, discovery writes, process changes, or release checks', async () => {
    captureStdout();
    const runDir = path.join(appDataDir, 'run');
    fs.mkdirSync(runDir);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'openchamber-inert-worker'], { stdio: 'ignore' });
    children.push(child);
    activeChild = child;
    await once(child, 'spawn');
    const pidPath = path.join(runDir, 'openchamber-45123.pid');
    const instancePath = path.join(runDir, 'openchamber-45123.json');
    const pidBytes = `${child.pid}\n`;
    const instanceBytes = JSON.stringify({ port: 45123, launchMode: 'daemon', startedAt: 123 });
    fs.writeFileSync(pidPath, pidBytes);
    fs.writeFileSync(instancePath, instanceBytes);
    fs.writeFileSync(path.join(appDataDir, 'sentinel.txt'), 'preserve app data');
    const command = makeCommand({ managed: false });
    let failure;
    try {
      await command.updateCommand({ json: true });
    } catch (error) {
      failure = error;
    }

    const observed = {
      refused: failure instanceof Error,
      managedChecks: command.isManagedInstall.mock.calls.length,
      releaseChecks: command.checkForUpdates.mock.calls.length,
      installs: command.executeUpdate.mock.calls.length,
      fetchCalls,
      pidExists: fs.existsSync(pidPath),
      pidBytes: fs.existsSync(pidPath) ? fs.readFileSync(pidPath, 'utf8') : null,
      instanceExists: fs.existsSync(instancePath),
      instanceBytes: fs.existsSync(instancePath) ? fs.readFileSync(instancePath, 'utf8') : null,
      sentinel: fs.readFileSync(path.join(appDataDir, 'sentinel.txt'), 'utf8'),
      processAlive: (() => { try { process.kill(child.pid, 0); return true; } catch { return false; } })(),
    };

    expect(observed).toEqual({
      refused: true,
      managedChecks: 1,
      releaseChecks: 0,
      installs: 0,
      fetchCalls: [],
      pidExists: true,
      pidBytes,
      instanceExists: true,
      instanceBytes,
      sentinel: 'preserve app data',
      processAlive: true,
    });
  });

  it('updates a managed install in non-TTY JSON mode with one JSON result', async () => {
    captureStdout();
    const command = makeCommand();
    await command.updateCommand({ json: true });

    expect(command.isManagedInstall).toHaveBeenCalledOnce();
    expect(command.executeUpdate).toHaveBeenCalledWith({ targetVersion: '1.2.3', silent: true });
    expect(output).toBe(`${JSON.stringify({
      currentVersion: '1.2.2', latestVersion: '1.2.3', updated: true, restartedCount: 0,
    })}\n`);
    expect(output).not.toContain('\u001b[');
  });

  it('prints truthful nonanimated status in ordinary non-TTY mode', async () => {
    captureStdout();
    const command = makeCommand();
    await command.updateCommand({});

    expect(command.isManagedInstall).toHaveBeenCalledOnce();
    expect(command.checkForUpdates).toHaveBeenCalledOnce();
    expect(command.executeUpdate).toHaveBeenCalledWith({ targetVersion: '1.2.3', silent: false });
    expect(command.serveCalls).toBe(0);
    expect(output).toContain('1.2.3');
    expect(output).not.toContain('\u001b[');
  });

  it('prints one concise quiet result when already current', async () => {
    captureStdout();
    const command = makeCommand({ available: false, currentVersion: '1.2.3' });
    await command.updateCommand({ quiet: true });

    expect(command.executeUpdate).not.toHaveBeenCalled();
    expect(output).toBe('up-to-date 1.2.3\n');
  });

  it('prints one concise quiet result after a managed release update', async () => {
    captureStdout();
    const command = makeCommand();
    await command.updateCommand({ quiet: true });

    expect(command.executeUpdate).toHaveBeenCalledWith({ targetVersion: '1.2.3', silent: true });
    expect(output).toBe('updated 1.2.3\n');
    expect(output).not.toContain('\u001b[');
  });

  it('surfaces activation failure without claiming an update succeeded', async () => {
    captureStdout();
    const command = makeCommand({ updateResult: { success: false, error: 'checksum mismatch' } });
    let failure;
    try {
      await command.updateCommand({ json: true });
    } catch (error) {
      failure = error;
    }

    expect({ message: failure?.message, successClaimed: output.includes('"updated":true') })
      .toEqual({ message: 'checksum mismatch', successClaimed: false });
  });
});
