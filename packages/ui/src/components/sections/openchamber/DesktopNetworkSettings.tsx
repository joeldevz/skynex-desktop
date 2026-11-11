import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getDesktopLanAddress,
  isDesktopLocalOriginActive,
  isDesktopShell,
  restartDesktopApp,
} from '@/lib/desktop';
import { useI18n } from '@/lib/i18n';
import { loadDesktopSettings } from '@/lib/persistence';
import { getRuntimeApiBaseUrl, getRuntimeKey } from '@/lib/runtime-switch';
import {
  SettingsSection,
  SettingsCheckboxRow,
  SettingsStackedField,
} from '@/components/sections/shared/SettingsSection';
import { useEnterprisePolicyStore } from '@/stores/useEnterprisePolicyStore';

import { saveDesktopRestartDrafts, useDesktopRestartDrafts } from './desktopRestartDrafts';

/**
 * Who may open the desktop app over the network: the UI password and access
 * from the local network. Both apply on the next launch, so they are drafts
 * until "Save + restart", which also saves the restart drafts of
 * `DesktopAppSettings` (`desktopRestartDrafts.ts`).
 */
export const DesktopNetworkSettings: React.FC<{ variant?: 'network' | 'tunnel' }> = ({ variant = 'network' }) => {
  const { t } = useI18n();
  const isTunnelVariant = variant === 'tunnel';
  const isLocalDesktop = isDesktopShell() && isDesktopLocalOriginActive();
  const [savedValue, setSavedValue] = React.useState(false);
  const [draftValue, setDraftValue] = React.useState(false);
  // The password is write-only: the server says whether one is set, and the
  // page sends a value only when the user types a new one or removes it.
  const [hasSavedPassword, setHasSavedPassword] = React.useState(false);
  const [draftPassword, setDraftPassword] = React.useState('');
  const [removePassword, setRemovePassword] = React.useState(false);
  const [lanAccessActive, setLanAccessActive] = React.useState(false);
  const [lanAccessBlockedReason, setLanAccessBlockedReason] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lanAddress, setLanAddress] = React.useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = React.useState(false);

  React.useEffect(() => {
    if (!isLocalDesktop) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const data = await loadDesktopSettings();
        if (!data) {
          throw new Error(t('settings.openchamber.desktopNetwork.error.loadFailed'));
        }
        if (cancelled) {
          return;
        }

        const enabled = data.desktopLanAccessEnabled === true;
        setSavedValue(enabled);
        setDraftValue(enabled);
        setHasSavedPassword(data.hasDesktopUiPassword === true);
        setDraftPassword('');
        setRemovePassword(false);
        setLanAccessActive(data.desktopLanAccessActive === true);
        setLanAccessBlockedReason(data.desktopLanAccessBlockedReason ?? null);
        setError(null);
        setLoadFailed(false);
      } catch (cause) {
        if (!cancelled) {
          setLoadFailed(true);
          setError(cause instanceof Error ? cause.message : t('settings.openchamber.desktopNetwork.error.loadFailed'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLocalDesktop, t]);

  React.useEffect(() => {
    if (!isLocalDesktop || isTunnelVariant || !draftValue) {
      setLanAddress(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const address = await getDesktopLanAddress();
      if (!cancelled) {
        setLanAddress(address);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftValue, isLocalDesktop, isTunnelVariant]);

  const nextPassword = draftPassword.trim();
  const passwordDirty = nextPassword.length > 0 || removePassword;
  const isDirty = draftValue !== savedValue || passwordDirty;
  const currentPort = React.useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    const runtimeApiBaseUrl = getRuntimeApiBaseUrl();
    const portSource = runtimeApiBaseUrl || window.location.href;
    let parsed = 0;
    try {
      parsed = Number(new URL(portSource).port);
    } catch {
      parsed = Number(window.location.port);
    }
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, []);
  const lanUrl = draftValue && lanAccessActive && lanAddress && currentPort ? `http://${lanAddress}:${currentPort}` : null;
  const passwordWillBeSet = nextPassword.length > 0 || (hasSavedPassword && !removePassword);
  const lanRequiresPassword = draftValue && !passwordWillBeSet;
  const lanBlockedByMissingPassword = savedValue && !lanAccessActive && lanAccessBlockedReason === 'missing-password';
  // Enterprise mode without the administrator's allowance: the desktop binds
  // loopback and the server refuses a network address, so there is no choice here.
  const lanBlockedByEnterprise = useEnterprisePolicyStore((state) => state.networkAccessBlocked)
    || lanAccessBlockedReason === 'enterprise-mode';
  const setRestartDraft = useDesktopRestartDrafts((state) => state.setDraft);
  const hasPendingRestart = useDesktopRestartDrafts((state) => Boolean(state.patches.app || state.patches.network));
  const saveDisabled = isLoading || loadFailed || isSaving || (isTunnelVariant
    ? (!nextPassword && !needsRestart)
    : ((!hasPendingRestart && !needsRestart) || lanRequiresPassword));

  // Publishes this section's pending changes, so a restart from the desktop
  // app section saves them too, or waits while they cannot be saved.
  React.useEffect(() => {
    setRestartDraft('network', isLocalDesktop && isDirty && !lanRequiresPassword ? {
      ...(draftValue !== savedValue ? { desktopLanAccessEnabled: draftValue } : {}),
      // Omitted when unchanged: the server keeps the password it has.
      ...(nextPassword ? { desktopUiPassword: nextPassword } : removePassword ? { desktopUiPassword: '' } : {}),
    } : null, lanRequiresPassword);
  }, [draftValue, isDirty, isLocalDesktop, lanRequiresPassword, nextPassword, removePassword, savedValue, setRestartDraft]);
  React.useEffect(() => () => setRestartDraft('network', null, false), [setRestartDraft]);

  const handlePasswordChange = React.useCallback((value: string) => {
    setDraftPassword(value);
    if (value.trim()) {
      setRemovePassword(false);
    }
  }, []);

  const handleRemovePassword = React.useCallback(() => {
    setDraftPassword('');
    setRemovePassword(true);
    setDraftValue(false);
  }, []);

  const handleSaveAndRestart = React.useCallback(async () => {
    if (saveDisabled || !isDesktopShell() || !isDesktopLocalOriginActive()) return;
    const runtimeKey = getRuntimeKey();
    let settingsSaved = false;
    setIsSaving(true);
    setError(null);

    try {
      // Saves the desktop app section's pending changes as well: the restart
      // would drop them otherwise.
      if (hasPendingRestart) {
        if (!await saveDesktopRestartDrafts()) {
          throw new Error(t('settings.openchamber.desktopNetwork.error.saveFailed'));
        }
        settingsSaved = true;
      }

      if (runtimeKey !== getRuntimeKey() || !isDesktopShell() || !isDesktopLocalOriginActive()) return;

      setSavedValue(draftValue);
      if (nextPassword) {
        setHasSavedPassword(true);
      } else if (removePassword) {
        setHasSavedPassword(false);
      }
      setDraftPassword('');
      setRemovePassword(false);
      setNeedsRestart(false);

      const restarted = await restartDesktopApp();
      if (!restarted) {
        setNeedsRestart(true);
        throw new Error(t('settings.openchamber.desktopNetwork.error.savedRestartFailed'));
      }
    } catch (cause) {
      if (settingsSaved) setNeedsRestart(true);
      setError(cause instanceof Error ? cause.message : t('settings.openchamber.desktopNetwork.error.saveFailed'));
      setIsSaving(false);
    }
  }, [draftValue, hasPendingRestart, nextPassword, removePassword, saveDisabled, t]);

  if (!isLocalDesktop) {
    return null;
  }

  return (
    <SettingsSection title={isTunnelVariant ? undefined : t('settings.layout.general.network.title')} contentClassName="space-y-4">
      <SettingsStackedField
        settingsItem={isTunnelVariant ? 'tunnel.ui-password' : 'sessions.desktop-ui-password'}
        label={(
          <label htmlFor={isTunnelVariant ? 'tunnel-ui-password' : 'desktop-ui-password'}>
            {t('settings.openchamber.desktopPassword.field.password')}
          </label>
        )}
        info={t(isTunnelVariant ? 'settings.openchamber.tunnel.password.description' : 'settings.openchamber.desktopPassword.field.passwordDescription')}
      >
        <Input
          id={isTunnelVariant ? 'tunnel-ui-password' : 'desktop-ui-password'}
          type="password"
          className="h-8 min-w-0 flex-1"
          value={draftPassword}
          onChange={(event) => handlePasswordChange(event.target.value)}
          placeholder={t(isTunnelVariant ? 'settings.openchamber.tunnel.password.placeholder' : hasSavedPassword && !removePassword
            ? 'settings.openchamber.desktopPassword.field.passwordSetPlaceholder'
            : 'settings.openchamber.desktopPassword.field.passwordPlaceholder')}
          disabled={isLoading || loadFailed || isSaving}
          required={draftValue && !passwordWillBeSet}
          aria-invalid={lanRequiresPassword}
        />
        {!isTunnelVariant && hasSavedPassword && !removePassword ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleRemovePassword}
            disabled={isLoading || loadFailed || isSaving}
            className="shrink-0 !font-normal"
          >
            {t('settings.openchamber.desktopPassword.actions.removePassword')}
          </Button>
        ) : null}
      </SettingsStackedField>

      {!isTunnelVariant ? <SettingsCheckboxRow
        settingsItem="sessions.desktop-lan-access"
        checked={draftValue && !lanBlockedByEnterprise}
        onChange={setDraftValue}
        disabled={isLoading || isSaving || lanBlockedByEnterprise}
        label={t('settings.openchamber.desktopNetwork.field.allowLanAccess')}
        info={t('settings.openchamber.desktopNetwork.field.allowLanAccessDescription')}
        description={lanBlockedByEnterprise ? (
          <span className="block">{t('settings.openchamber.desktopNetwork.field.enterpriseBlocked')}</span>
        ) : (
          <>
            <span className="block text-[var(--status-warning)]/85">
              {t('settings.openchamber.desktopNetwork.field.warning')}
            </span>
            {lanRequiresPassword || lanBlockedByMissingPassword ? (
              <span className="block text-[var(--status-warning)]/85">
                {t('settings.openchamber.desktopNetwork.field.passwordRequiredWarning')}
              </span>
            ) : null}
          </>
        )}
        ariaLabel={t('settings.openchamber.desktopNetwork.field.allowLanAccessAria')}
      /> : null}

      {!isTunnelVariant && lanUrl && !lanBlockedByEnterprise ? (
        <p className="typography-meta text-muted-foreground">
          {isDirty && !savedValue
            ? t('settings.openchamber.desktopNetwork.hint.openAfterRestart')
            : t('settings.openchamber.desktopNetwork.hint.openNow')}
          <span className="font-mono text-foreground">{lanUrl}</span>
        </p>
      ) : null}

      <p className="min-h-5 truncate typography-micro text-[var(--status-error)]" role={error ? 'alert' : undefined} title={error ?? undefined}>{error}</p>

      <Button
        type="button"
        size="xs"
        onClick={handleSaveAndRestart}
        disabled={saveDisabled}
        className="!font-normal"
      >
        {isSaving ? t('settings.common.actions.saving') : t('settings.openchamber.desktopNetwork.actions.saveAndRestart')}
      </Button>
    </SettingsSection>
  );
};
