import {
  intro as clackIntro,
  outro as clackOutro,
  isJsonMode,
  isQuietMode,
  shouldRenderHumanOutput,
  createSpinner,
  logStatus,
} from '../cli-output.js';

function createUpdateCommand({ importFromFilePath, packageManagerPath }) {
  return async function updateCommand(options = {}) {
    const { isManagedInstall, checkForUpdates, executeUpdate, getCurrentVersion } = await importFromFilePath(packageManagerPath);
    if (!isManagedInstall()) throw new Error('This source or unmanaged installation cannot update itself. Install a standalone skynex-app release first.');

    const currentVersion = getCurrentVersion();
    const showOutput = shouldRenderHumanOutput(options);
    const spinner = createSpinner(options);
    if (showOutput) clackIntro('Skynex Update');
    if (showOutput && !spinner) logStatus('info', `current version: ${currentVersion}`);
    spinner?.start('Checking for updates...');

    try {
      const updateInfo = await checkForUpdates({ currentVersion });
      if (updateInfo.error) throw new Error(updateInfo.error);
      if (!updateInfo.available) {
        spinner?.stop('Already up to date');
        if (isJsonMode(options)) process.stdout.write(`${JSON.stringify({ currentVersion, latestVersion: updateInfo.version || currentVersion, updated: false })}\n`);
        else if (showOutput) {
          if (!spinner) logStatus('success', 'you are running the latest version');
          clackOutro('no update needed');
        } else if (isQuietMode(options)) process.stdout.write(`up-to-date ${currentVersion}\n`);
        return;
      }

      const targetVersion = updateInfo.version;
      spinner?.message(`Installing ${targetVersion}...`);
      if (showOutput && !spinner) logStatus('info', `updating ${currentVersion} -> ${targetVersion}`);
      const result = await executeUpdate({ targetVersion, silent: isJsonMode(options) || isQuietMode(options) });
      if (!result.success) throw new Error(result.error || `Update failed with exit code ${result.exitCode}`);

      spinner?.stop(`Updated to ${targetVersion}`);
      if (isJsonMode(options)) process.stdout.write(`${JSON.stringify({ currentVersion, latestVersion: targetVersion, updated: true, restartedCount: 0 })}\n`);
      else if (showOutput) {
        if (!spinner) logStatus('success', `updated to ${targetVersion}`);
        clackOutro('update complete. Restart the app to use the new version.');
      } else if (isQuietMode(options)) process.stdout.write(`updated ${targetVersion}\n`);
    } catch (error) {
      spinner?.error('Update failed');
      if (showOutput) clackOutro('update failed');
      throw error;
    }
  };
}

export { createUpdateCommand };
