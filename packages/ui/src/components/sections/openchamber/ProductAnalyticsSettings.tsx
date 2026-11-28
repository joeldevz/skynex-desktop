import React from 'react';
import { SettingsCheckboxRow, SettingsSection } from '@/components/sections/shared/SettingsSection';
import { getDesktopProductAnalyticsSettings, setDesktopProductAnalyticsEnabled, type ProductAnalyticsSettings as AnalyticsPreference } from '@/lib/desktop';
import { useI18n } from '@/lib/i18n';
import { reportSettingsSaveState } from '@/lib/persistence';

export const ProductAnalyticsSettings: React.FC = () => {
  const { t } = useI18n();
  const [settings, setSettings] = React.useState<AnalyticsPreference | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void getDesktopProductAnalyticsSettings().then((result) => {
      if (active) setSettings(result);
    }).catch(() => {
      if (active) reportSettingsSaveState('error');
    });
    return () => { active = false; };
  }, []);

  const change = async (enabled: boolean) => {
    if (!settings || saving) return;
    setSaving(true);
    reportSettingsSaveState('saving');
    try {
      setSettings(await setDesktopProductAnalyticsEnabled(enabled));
      reportSettingsSaveState('saved');
    } catch {
      reportSettingsSaveState('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title={t('settings.productAnalytics.section')}>
      <SettingsCheckboxRow
        settingsItem="general.product-analytics"
        checked={settings?.enabled ?? false}
        onChange={(enabled) => void change(enabled)}
        disabled={!settings || saving}
        label={t('settings.productAnalytics.label')}
        description={<>{t('settings.productAnalytics.disclosure')} {settings && !settings.available ? t('settings.productAnalytics.inactive') : null}</>}
      />
    </SettingsSection>
  );
};
