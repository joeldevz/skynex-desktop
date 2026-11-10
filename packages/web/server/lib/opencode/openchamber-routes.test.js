import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import path from 'node:path';
import request from 'supertest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('../package-manager.js', () => ({
  checkForUpdates: vi.fn(),
  getUpdateCommand: vi.fn(),
  detectPackageManagerDetails: vi.fn(),
  isUnmanagedInstall: vi.fn(),
}));

const childProcess = await import('child_process');
const packageManager = await import('../package-manager.js');
const { registerOpenChamberRoutes } = await import('./openchamber-routes.js');

const createApp = ({
  environment = {},
  storedOptions = {},
  desktopUpdater,
  platform = 'linux',
  execPath = '/usr/bin/node',
  plistExists = false,
} = {}) => {
  const app = express();
  const dependencies = {
    fs: {
      existsSync: vi.fn((targetPath) => {
        if (typeof targetPath === 'string' && targetPath.endsWith('dev.openchamber.web.plist')) {
          return plistExists;
        }
        return false;
      }),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      openSync: vi.fn(() => 7),
      closeSync: vi.fn(),
      promises: {
        readFile: vi.fn(async () => JSON.stringify({
          launchMode: 'foreground',
          port: 7897,
          ...storedOptions,
        })),
      },
    },
    os: {
      homedir: () => '/home/test',
    },
    path,
    process: {
      env: environment,
      platform,
      execPath,
      exit: vi.fn(),
    },
    server: {
      address: () => ({ port: 7897 }),
      close: vi.fn(),
    },
    __dirname: '/opt/openchamber/server',
    openchamberDataDir: '/tmp/openchamber',
    modelsDevApiUrl: 'https://models.example.test',
    modelsMetadataCacheTtl: 0,
    readSettingsFromDiskMigrated: vi.fn(),
    fetchFreeZenModels: vi.fn(),
    getCachedZenModels: vi.fn(),
    desktopUpdater,
  };

  registerOpenChamberRoutes(app, dependencies);
  return { app, dependencies };
};

beforeEach(() => {
  packageManager.checkForUpdates.mockResolvedValue({
    available: true,
    version: '1.17.1',
  });
  packageManager.detectPackageManagerDetails.mockReturnValue({
    packageManager: 'npm',
  });
  packageManager.getUpdateCommand.mockReturnValue('npm install -g @openchamber/web@latest');
  packageManager.isUnmanagedInstall.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('OpenChamber desktop host update route', () => {
  it('reports a restart rejection until the user retries installation', async () => {
    const desktopUpdater = {
      check: vi.fn(async () => ({ available: true, currentVersion: '1.17.0', version: '1.17.1' })),
      install: vi.fn(async () => ({ available: true, version: '1.17.1' })),
      restart: vi.fn().mockRejectedValueOnce(new Error('Signature rejected')).mockResolvedValue(undefined),
    };
    const { app } = createApp({ environment: { OPENCHAMBER_RUNTIME: 'desktop' }, desktopUpdater });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(app).post('/api/openchamber/update-install').expect(200);
    await new Promise(resolve => setImmediate(resolve));
    await request(app).get('/api/openchamber/update-check?appType=web&reportUsage=false&updateStatus=true').expect(503, {
      code: 'DESKTOP_UPDATE_RESTART_FAILED', error: 'Signature rejected',
    });
    expect(desktopUpdater.check).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledOnce();
    // Availability remains reachable after a browser reload, so users can retry.
    await request(app).get('/api/openchamber/update-check?appType=web&reportUsage=false').expect(200);

    await request(app).post('/api/openchamber/update-install').expect(200);
    await new Promise(resolve => setImmediate(resolve));
    const response = await request(app).get('/api/openchamber/update-check?appType=web&reportUsage=false').expect(200);
    expect(response.body.currentVersion).toBe('1.17.0');
    expect(response.body.updateOwner).toBe('electron-updater');
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
  });

  it('rejects native checks without a bridge and preserves explicit non-web checks', async () => {
    const { app } = createApp({ environment: { OPENCHAMBER_RUNTIME: 'desktop' } });
    await request(app).get('/api/openchamber/update-check?appType=web').expect(503, {
      available: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: 'The desktop updater is not available.',
    });
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    await request(app).get('/api/openchamber/update-check?appType=desktop-electron').expect(200);
    expect(packageManager.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('uses electron-updater to check for Web client updates', async () => {
    const desktopUpdater = {
      check: vi.fn(async () => ({
        available: true,
        currentVersion: '1.17.0',
        version: '1.17.1',
      })),
      install: vi.fn(),
      restart: vi.fn(),
    };
    const { app } = createApp({
      environment: {
        OPENCHAMBER_RUNTIME: 'desktop',
      },
      desktopUpdater,
    });

    await request(app)
      .get('/api/openchamber/update-check?appType=web&reportUsage=false')
      .expect(200, {
        available: true,
        currentVersion: '1.17.0',
        version: '1.17.1',
        packageManager: 'electron',
        updateOwner: 'electron-updater',
      });

    expect(desktopUpdater.check).toHaveBeenCalledOnce();
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
  });

  it('installs through electron-updater and restarts after responding', async () => {
    const desktopUpdater = {
      check: vi.fn(),
      install: vi.fn(async () => ({
        available: true,
        version: '1.17.1',
      })),
      restart: vi.fn(),
    };
    const { app } = createApp({
      environment: {
        OPENCHAMBER_RUNTIME: 'desktop',
      },
      desktopUpdater,
    });

    await request(app)
      .post('/api/openchamber/update-install')
      .expect(200, {
        success: true,
        message: 'Desktop update downloaded, host will restart shortly',
        version: '1.17.1',
        packageManager: 'electron',
        updateOwner: 'electron-updater',
        autoRestart: true,
        restartManager: 'electron-updater',
      });
    await new Promise((resolve) => setImmediate(resolve));

    expect(desktopUpdater.install).toHaveBeenCalledOnce();
    expect(desktopUpdater.restart).toHaveBeenCalledOnce();
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    expect(packageManager.detectPackageManagerDetails).not.toHaveBeenCalled();
    expect(packageManager.getUpdateCommand).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });

  it('refuses a remote install the desktop host must run on its own screen, without restarting', async () => {
    const desktopUpdater = {
      check: vi.fn(),
      install: vi.fn(async () => ({ available: true, version: '1.17.1', installBlocked: 'desktop-host' })),
      restart: vi.fn(),
    };
    const { app } = createApp({ environment: { OPENCHAMBER_RUNTIME: 'desktop' }, desktopUpdater });

    await request(app).post('/api/openchamber/update-install').expect(409, {
      code: 'DESKTOP_UPDATE_LOCAL_ONLY',
      error: 'Update OpenChamber on the computer it runs on.',
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(desktopUpdater.restart).not.toHaveBeenCalled();
  });

  it('fails safely when the Electron updater bridge is unavailable', async () => {
    const { app } = createApp({
      environment: {
        OPENCHAMBER_RUNTIME: 'desktop',
      },
    });

    await request(app)
      .post('/api/openchamber/update-install')
      .expect(503, {
        code: 'DESKTOP_UPDATER_UNAVAILABLE',
        error: 'The desktop updater is not available.',
      });

    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});

describe('OpenChamber standalone web updates', () => {
  it('advertises manual CLI installation for a web update', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/openchamber/update-check?appType=web').expect(200);

    expect(response.body).toMatchObject({ available: true, installBlocked: 'manual-install' });
  });

  it('refuses web update installation with CLI instructions without starting package or server lifecycle work', async () => {
    const { app } = createApp({ storedOptions: { launchMode: 'daemon' } });

    await request(app).post('/api/openchamber/update-install').expect(409, {
      code: 'MANUAL_UPDATE_REQUIRED',
      error: 'Web and hosted mobile installations must be updated with the skynex-app CLI. Run skynex-app update, then restart the server.',
    });

    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    expect(packageManager.detectPackageManagerDetails).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });
});
