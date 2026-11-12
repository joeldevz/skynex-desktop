import { publicEnterprisePolicy } from '../enterprise-mode.js';

export const registerOpenChamberRoutes = (app, dependencies) => {
  const {
    process,
    modelsDevApiUrl,
    modelsMetadataCacheTtl,
    readSettingsFromDiskMigrated,
    fetchFreeZenModels,
    getCachedZenModels,
    desktopUpdater,
  } = dependencies;

  let desktopRestartError = null;

  // Whether an administrator turned on enterprise mode, and by which source.
  // Pinned endpoints and keys never leave the server.
  app.get('/api/openchamber/enterprise-policy', (_req, res) => {
    res.json(publicEnterprisePolicy());
  });

  app.get('/api/openchamber/update-check', async (req, res) => {
    try {
      const parseString = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);
      const parseReportUsage = (value) => {
        if (typeof value !== 'string') return true;
        const normalized = value.trim().toLowerCase();
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        return true;
      };
      const inferDeviceClass = (ua) => {
        const value = (ua || '').toLowerCase();
        if (!value) return 'unknown';
        if (value.includes('ipad') || value.includes('tablet')) return 'tablet';
        if (value.includes('mobi') || value.includes('android') || value.includes('iphone')) return 'mobile';
        return 'desktop';
      };
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
      const updateRequest = {
        appType: parseString(req.query.appType),
        deviceClass: parseString(req.query.deviceClass) || inferDeviceClass(userAgent),
        platform: parseString(req.query.platform),
        arch: parseString(req.query.arch),
        instanceMode: parseString(req.query.instanceMode),
        currentVersion: parseString(req.query.currentVersion),
        installId: parseString(req.query.installId),
        reportUsage: parseReportUsage(parseString(req.query.reportUsage)),
      };
      let updateInfo;
      if (process.env.OPENCHAMBER_RUNTIME === 'desktop' && updateRequest.appType === 'web') {
        if (desktopRestartError && req.query.updateStatus === 'true') {
          return res.status(503).json({
            code: 'DESKTOP_UPDATE_RESTART_FAILED',
            error: desktopRestartError,
          });
        }
        if (typeof desktopUpdater?.check !== 'function') {
          return res.status(503).json({
            available: false,
            code: 'DESKTOP_UPDATER_UNAVAILABLE',
            error: 'The desktop updater is not available.',
          });
        }
        updateInfo = {
          ...await desktopUpdater.check(),
          packageManager: 'electron',
          updateOwner: 'electron-updater',
        };
      } else {
        const { checkForUpdates } = await import('../package-manager.js');
        updateInfo = await checkForUpdates(updateRequest);
        if (updateInfo?.available && updateRequest.appType === 'web') {
          updateInfo = { ...updateInfo, installBlocked: 'manual-install' };
        }
      }
      res.json(updateInfo);
    } catch (error) {
      console.error('Failed to check for updates:', error);
      res.status(500).json({
        available: false,
        error: error instanceof Error ? error.message : 'Failed to check for updates',
      });
    }
  });

  app.post('/api/openchamber/update-install', async (_req, res) => {
    try {
      if (process.env.OPENCHAMBER_RUNTIME === 'desktop') {
        if (typeof desktopUpdater?.install !== 'function' || typeof desktopUpdater?.restart !== 'function') {
          return res.status(503).json({
            code: 'DESKTOP_UPDATER_UNAVAILABLE',
            error: 'The desktop updater is not available.',
          });
        }

        desktopRestartError = null;
        const updateInfo = await desktopUpdater.install();
        if (!updateInfo?.available) {
          return res.status(400).json({ error: 'No update available' });
        }
        if (updateInfo.installBlocked === 'desktop-host') {
          return res.status(409).json({
            code: 'DESKTOP_UPDATE_LOCAL_ONLY',
            error: 'Update OpenChamber on the computer it runs on.',
          });
        }

        res.json({
          success: true,
          message: 'Desktop update downloaded, host will restart shortly',
          version: updateInfo.version,
          packageManager: 'electron',
          updateOwner: 'electron-updater',
          autoRestart: true,
          restartManager: 'electron-updater',
        });

        setImmediate(() => {
          Promise.resolve()
            .then(() => desktopUpdater.restart())
            .catch((error) => {
              desktopRestartError = error instanceof Error ? error.message : 'Failed to restart after desktop update';
              console.error('Failed to restart after desktop update:', error);
            });
        });
        return;
      }

      return res.status(409).json({
        code: 'MANUAL_UPDATE_REQUIRED',
        error: 'Web and hosted mobile installations must be updated with the skynex-app CLI. Run skynex-app update, then restart the server.',
      });

    } catch (error) {
      console.error('Failed to install update:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to install update',
      });
    }
  });

  app.get('/api/openchamber/models-metadata', async (_req, res) => {
    try {
      const { getModelsMetadata, toClientModelsMetadata } = await import('./models-metadata.js');
      const { metadata, fromCache, stale } = await getModelsMetadata({
        url: modelsDevApiUrl,
        ttlMs: modelsMetadataCacheTtl,
      });
      res.setHeader('Cache-Control', fromCache && !stale ? 'public, max-age=60' : 'public, max-age=300');
      res.json(toClientModelsMetadata(metadata));
    } catch (error) {
      console.warn('Failed to fetch models.dev metadata via server:', error);
      const statusCode = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 502;
      res.status(statusCode).json({ error: 'Failed to retrieve model metadata' });
    }
  });

  app.get('/api/zen/models', async (_req, res) => {
    try {
      const models = await fetchFreeZenModels();
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ models });
    } catch (error) {
      console.warn('Failed to fetch zen models:', error);
      const cachedZenModels = getCachedZenModels();
      if (cachedZenModels) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(cachedZenModels);
      } else {
        const statusCode = error?.name === 'AbortError' ? 504 : 502;
        res.status(statusCode).json({ error: 'Failed to retrieve zen models' });
      }
    }
  });
};
