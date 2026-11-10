import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 1, stdout: '', stderr: '' })),
}));

const { checkForUpdates, detectPackageManagerDetails, executeUpdate, getCurrentVersion, isUnmanagedInstall } =
  await import('./package-manager.js');

const releasesApi = 'https://api.github.com/repos/joeldevz/skynex-desktop/releases/latest';

function makeRelease(version = '1.10.0') {
  const archiveName = `skynex-app-${version}-linux-x64.tar.gz`;
  const archiveUrl = `https://github.com/joeldevz/skynex-desktop/releases/download/v${version}/${archiveName}`;
  return {
    tag_name: `v${version}`,
    assets: [
      { name: archiveName, browser_download_url: archiveUrl },
      { name: `${archiveName}.sha256`, browser_download_url: `${archiveUrl}.sha256` },
    ],
  };
}

describe('package-manager update compatibility API', () => {
  let originalFetch;
  let fetchMock;
  let tempHome;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-update-home-'));
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('USERPROFILE', tempHome);
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async (url) => {
      if (String(url) === releasesApi) return { ok: true, json: async () => makeRelease() };
      throw new Error(`Unexpected update source: ${String(url)}`);
    });
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    spawnSync.mockReset();
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  });

  it('checks the canonical GitHub release directly without upstream update API or npm registry calls', async () => {
    const result = await checkForUpdates({ currentVersion: '1.9.0', platform: 'linux', arch: 'x64' });

    expect(result).toMatchObject({
      available: true,
      version: '1.10.0',
      currentVersion: '1.9.0',
      updateCommand: 'skynex-app update',
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([releasesApi]);
  });

  it('reports no update when the owned GitHub release tag matches the current version', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === releasesApi) return { ok: true, json: async () => makeRelease('1.9.0') };
      throw new Error(`Unexpected update source: ${String(url)}`);
    });

    const result = await checkForUpdates({ currentVersion: '1.9.0', platform: 'linux', arch: 'x64' });

    expect(result.available).toBe(false);
    expect(result.version).toBe('1.9.0');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not send usage telemetry while checking release metadata', async () => {
    await checkForUpdates({
      currentVersion: '1.9.0',
      appType: 'desktop-electron',
      installId: 'install-id-must-not-be-sent',
      platform: 'linux',
      arch: 'x64',
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([releasesApi]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('install-id-must-not-be-sent');
    expect(fs.existsSync(path.join(tempHome, '.config', 'openchamber', 'install-id-desktop-electron'))).toBe(false);
  });

  it('returns an explicit release-check error without falling back to upstream or npm services', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === releasesApi) return { ok: false, status: 503 };
      throw new Error(`Forbidden fallback: ${String(url)}`);
    });

    const result = await checkForUpdates({ currentVersion: '1.9.0', platform: 'linux', arch: 'x64' });

    expect(result.available).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([releasesApi]);
  });

  it('never runs a package-manager install for a CLI update', () => {
    const result = executeUpdate('npm', { targetVersion: '1.10.0' });

    expect(result.success).toBe(false);
    expect(spawnSync.mock.calls.some(([command, args]) => (
      `${String(command)} ${Array.isArray(args) ? args.join(' ') : String(args ?? '')}`
        .includes('npm install -g @openchamber/web')
    ))).toBe(false);
  });
});

describe('package-manager detection compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    spawnSync.mockReset();
    vi.unstubAllEnvs();
  });

  it.each([
    ['Windows pnpm store', String.raw`D:\pnpm-store\v11\links\@openchamber\web\2.5.1\hash\node_modules\@openchamber\web`, 'pnpm'],
    ['POSIX pnpm store', '/home/user/.local/share/pnpm-store/v11/links/@openchamber/web/2.5.1/hash/node_modules/@openchamber/web', 'pnpm'],
    ['case-insensitive Windows pnpm store', String.raw`D:\PNPM-STORE\v11\links\@openchamber\web\2.5.1\hash\node_modules\@openchamber\web`, 'pnpm'],
    ['pnpm virtual store', '/opt/global/node_modules/.pnpm/@openchamber+web@2.5.1/node_modules/@openchamber/web', 'pnpm'],
    ['npm install', '/usr/local/lib/node_modules/@openchamber/web', 'npm'],
    ['unrelated store name', '/opt/pnpm-store-backup/node_modules/@openchamber/web', 'npm'],
  ])('identifies %s from its install path when global roots cannot establish ownership', async (_name, packagePath, packageManager) => {
    vi.stubEnv('OPENCHAMBER_RUNTIME', '');
    vi.stubEnv('OPENCHAMBER_PACKAGE_MANAGER', '');
    vi.stubEnv('npm_config_user_agent', '');
    vi.stubEnv('npm_execpath', '');
    spawnSync.mockImplementation((command, args) => {
      if (command !== 'npm' && command !== 'pnpm') return { status: 1, stdout: '', stderr: '' };
      if (args[0] === '--version') return { status: 0, stdout: '10.0.0', stderr: '' };
      if (args[0] === 'list') return { status: 0, stdout: '@openchamber/web 2.5.1', stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    });
    vi.resetModules();
    const { detectPackageManagerDetails } = await import('./package-manager.js');
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const resolve = path.resolve;
    vi.spyOn(path, 'resolve').mockImplementation((...parts) => (
      parts.length === 3 && parts[0] === moduleDir && parts[1] === '..' && parts[2] === '..'
        ? packagePath
        : resolve(...parts)
    ));

    expect(detectPackageManagerDetails()).toMatchObject({
      packageManager,
      packagePath,
      reason: 'hinted-visible-install',
      globalNodeModulesRoot: null,
    });
  });

  it('keeps identifying an unpacked copy as unmanaged after initial detection', async () => {
    vi.stubEnv('OPENCHAMBER_RUNTIME', '');
    vi.stubEnv('OPENCHAMBER_PACKAGE_MANAGER', '');
    spawnSync.mockImplementation(() => ({ status: 1, stdout: '', stderr: '' }));
    vi.resetModules();
    const { detectPackageManagerDetails: detectDetails, isUnmanagedInstall: unmanaged } = await import('./package-manager.js');

    expect(detectDetails().reason).toBe('unmanaged-install');
    expect(detectDetails().reason).toBe('unmanaged-install');
    expect(unmanaged()).toBe(true);
  });

  it('keeps a valid current-version accessor for existing server consumers', () => {
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+|unknown$/);
    expect(typeof detectPackageManagerDetails).toBe('function');
    expect(typeof isUnmanagedInstall).toBe('function');
  });
});
