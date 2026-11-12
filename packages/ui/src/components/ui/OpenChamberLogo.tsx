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
  isAnimated = false,
  variant = 'default',
}) => {
  const { t } = useI18n();
  const themeContext = useOptionalThemeSystem();
  const animate = isAnimated && variant === 'splash';

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
      viewBox={variant === 'splash' ? ART.animatedViewBox : ART.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={t('openChamberLogo.aria.logo')}
    >
      {animate ? (
        <>
          <style>{'.skynex-logo-still{display:none}@media(prefers-reduced-motion:reduce){.skynex-logo-animated{display:none}.skynex-logo-still{display:inline}}'}</style>
          <path className="skynex-logo-still" d={ART.mark} fill={color} />
          <path className="skynex-logo-animated" d={ART.mark} fill={color}>
            {ART.animation.map((animation) => (
              <animate
                key={animation.attributeName}
                {...animation}
                values={animation.values.join(';')}
              />
            ))}
          </path>
        </>
      ) : <path d={ART.mark} fill={color} />}
    </svg>
  );
};
