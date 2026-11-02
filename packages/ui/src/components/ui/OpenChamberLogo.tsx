import React, { useMemo } from 'react';
import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';
import { useI18n } from '@/lib/i18n';
import { OPEN_CHAMBER_LOGO_ART as ART } from './openChamberLogoArt';

interface OpenChamberLogoProps {
  className?: string;
  width?: number;
  height?: number;
  isAnimated?: boolean;
  variant?: 'default' | 'splash';
}

// The S monogram is generated from scripts/brand, which also writes the HTML
// splashes shown before React.
export const OpenChamberLogo: React.FC<OpenChamberLogoProps> = ({
  className = '',
  width = 70,
  height = 70,
  variant = 'default',
}) => {
  const { t } = useI18n();
  const themeContext = useOptionalThemeSystem();

  const color = useMemo(() => {
    // Startup stages share the pre-paint palette while the app theme hydrates.
    if (variant === 'splash') {
      return 'var(--splash-stroke, var(--surface-foreground))';
    }
    if (themeContext) {
      return themeContext.currentTheme.colors.surface.foreground;
    }
    if (typeof window !== 'undefined') {
      const fromVars = getComputedStyle(document.documentElement).getPropertyValue('--splash-stroke').trim();
      if (fromVars) {
        return fromVars;
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'white' : 'black';
    }
    return 'white';
  }, [themeContext, variant]);

  return (
    <svg
      width={width}
      height={height}
      viewBox="-50 -50 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={t('openChamberLogo.aria.logo')}
    >
      <path d={ART.mark} transform={ART.transform} fill="none" stroke={color} strokeWidth={ART.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};
