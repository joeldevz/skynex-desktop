import type { Theme } from '@/types/theme';
import type { ThemeMode } from '@/types/theme';
import { getDefaultTheme } from '../themes';
import { contrastRatio, mixColor, onColor, readableText, withOpacity } from '../color';
import { adaptVSCodeRoles } from './adapt';

export type VSCodeThemeKind = 'light' | 'dark' | 'high-contrast';

type VSCodeThemeColorToken =
  // Editor core
  | 'editor.background'
  | 'editor.foreground'
  | 'editor.selectionBackground'
  | 'editor.selectionForeground'
  | 'editor.lineHighlightBackground'
  | 'editorCursor.foreground'
  // Chat
  | 'interactive-session.foreground'
  | 'chat.list.background'
  | 'chat.requestBorder'
  | 'chat.requestBackground'
  | 'chat.requestBubbleBackground'
  | 'chat.requestBubbleHoverBackground'
  | 'chat.avatarBackground'
  | 'chat.avatarForeground'
  | 'chat.slashCommandBackground'
  | 'chat.slashCommandForeground'
  | 'chat.editedFileForeground'
  | 'chat.requestCodeBorder'
  | 'chat.linesAddedForeground'
  | 'chat.linesRemovedForeground'
  | 'chat.thinkingShimmer'
  | 'chat.inputWorkingBorderColor1'
  | 'chat.inputWorkingBorderColor2'
  | 'chat.inputWorkingBorderColor3'
  | 'textBlockQuote.background'
  | 'textBlockQuote.border'
  | 'toolbar.hoverBackground'
  | 'toolbar.activeBackground'
  | 'toolbar.hoverOutline'
  | 'icon.foreground'
  | 'inputOption.activeForeground'
  | 'inputOption.activeBorder'
  | 'inputOption.activeBackground'
  | 'notificationsWarningIcon.foreground'
  | 'problemsWarningIcon.foreground'
  | 'problemsInfoIcon.foreground'
  // UI borders and focus
  | 'focusBorder'
  | 'contrastBorder'
  | 'widget.border'
  // Diff editor
  | 'diffEditor.insertedTextBackground'
  | 'diffEditor.insertedTextBorder'
  | 'diffEditor.insertedLineBackground'
  | 'diffEditor.removedTextBackground'
  | 'diffEditor.removedLineBackground'
  | 'gitDecoration.addedResourceForeground'
  | 'gitDecoration.deletedResourceForeground'
  | 'gitDecoration.modifiedResourceForeground'
  // Sidebar
  | 'sideBar.background'
  | 'sideBar.foreground'
  | 'sideBar.border'
  // Panel (bottom area)
  | 'panel.background'
  | 'panel.foreground'
  | 'panel.border'
  // Inputs
  | 'input.background'
  | 'input.foreground'
  | 'input.border'
  | 'input.placeholderForeground'
  // Buttons
  | 'button.background'
  | 'button.foreground'
  | 'button.hoverBackground'
  | 'button.secondaryBackground'
  | 'button.secondaryForeground'
  // Text
  | 'textLink.foreground'
  | 'textLink.activeForeground'
  | 'descriptionForeground'
  | 'foreground'
  // Terminal colors (for syntax)
  | 'terminal.ansiRed'
  | 'terminal.ansiGreen'
  | 'terminal.ansiBlue'
  | 'terminal.ansiYellow'
  | 'terminal.ansiCyan'
  | 'terminal.ansiMagenta'
  // Editor diagnostics
  | 'editorError.foreground'
  | 'editorError.background'
  | 'editorWarning.foreground'
  | 'editorWarning.background'
  | 'editorInfo.foreground'
  | 'editorInfo.background'
  // Testing
  | 'testing.iconPassed'
  | 'testing.iconFailed'
  // Badge
  | 'badge.background'
  | 'badge.foreground'
  | 'activityBarBadge.background'
  | 'list.highlightForeground'
  // Status bar
  | 'statusBar.background'
  | 'statusBar.foreground'
  // Lists
  | 'list.hoverBackground'
  | 'list.activeSelectionBackground'
  | 'list.activeSelectionForeground'
  | 'list.inactiveSelectionBackground'
  | 'menu.selectionBackground'
  | 'menu.selectionForeground'
  // Preformatted text (code)
  | 'textPreformat.foreground'
  | 'textPreformat.background'
  | 'textPreformat.border'
  // Editor widgets
  | 'editorWidget.background'
  | 'editorWidget.foreground'
  | 'editorWidget.border'
  // Dropdown
  | 'dropdown.background'
  | 'dropdown.foreground'
  | 'dropdown.border'
  // Editor gutter
  | 'editorLineNumber.foreground'
  | 'editorLineNumber.activeForeground'
  // Scrollbar
  | 'scrollbarSlider.background'
  | 'scrollbarSlider.hoverBackground';

export type VSCodeThemePalette = {
  kind: VSCodeThemeKind;
  colors: Partial<Record<VSCodeThemeColorToken, string>>;
  mode?: ThemeMode;
  highContrast?: boolean;
};

export type VSCodeThemePayload = {
  theme: Theme;
  palette: VSCodeThemePalette;
};

const applyAlpha = withOpacity;

export const buildVSCodeThemeFromPalette = (source: VSCodeThemePalette): Theme => {
  const palette = { ...source, colors: { ...source.colors } };
  const isDark = palette.kind === 'dark' || palette.kind === 'high-contrast';
  const base = getDefaultTheme(isDark);
  const colors = palette.colors;
  const canvas = colors['chat.list.background'] ?? colors['editor.background'] ?? base.colors.surface.background;
  const text = colors['interactive-session.foreground'] ?? colors.foreground ?? colors['editor.foreground'] ?? onColor(canvas, canvas);
  colors.foreground ??= text;
  colors['sideBar.background'] ??= colors['panel.background'] ?? mixColor(text, canvas, 0.03, canvas);
  if (!colors['editorWidget.background'] && !colors['dropdown.background'] && !colors['input.background']) {
    colors['editorWidget.background'] = mixColor(text, canvas, 0.04, canvas);
    colors['editorWidget.foreground'] = readableText(text, colors['editorWidget.background'], canvas);
  }
  colors.descriptionForeground ??= readableText(mixColor(text, canvas, 0.6, canvas), canvas);
  colors['widget.border'] ??= colors['input.border'] ?? colors['panel.border'] ?? mixColor(text, canvas, 0.15, canvas);
  colors['toolbar.hoverBackground'] ??= colors['list.hoverBackground'] ?? mixColor(text, canvas, 0.08, canvas);
  colors['toolbar.activeBackground'] ??= mixColor(text, canvas, 0.12, canvas);
  if (!colors['list.activeSelectionBackground'] && !colors['menu.selectionBackground'] && !colors['editor.selectionBackground']) {
    colors['list.activeSelectionBackground'] = mixColor(text, canvas, 0.16, canvas);
    colors['list.activeSelectionForeground'] = readableText(text, colors['list.activeSelectionBackground'], canvas);
  }
  if (!colors['button.background']) {
    colors['button.background'] = colors['textLink.foreground'] ?? colors.focusBorder ?? text;
    colors['button.foreground'] = onColor(colors['button.background'], canvas);
  }
  colors.focusBorder ??= colors['button.background'];
  colors['editorCursor.foreground'] ??= colors['editor.foreground'] ?? text;
  
  const read = (token: VSCodeThemeColorToken, fallback: string): string =>
    palette.colors[token] ?? fallback;
  const hasPaint = (value: string) => value !== 'transparent'
    && (contrastRatio(value, '#000000') !== 1 || contrastRatio(value, '#ffffff') !== 1);
  const readPaint = (token: VSCodeThemeColorToken, fallback: string) => {
    const value = read(token, fallback);
    return hasPaint(value) ? value : fallback;
  };

  // ===========================================
  // SURFACE COLORS - Layered backgrounds
  // ===========================================
  
  // The transcript is the main canvas. Sidebar and selection colors belong to
  // their own roles, even when the source palette happens to make them equal.
  const background = read('chat.list.background', read('editor.background', base.colors.surface.background));
  
  // Main foreground text color
  const foreground = read('interactive-session.foreground', read('foreground', read('editor.foreground', base.colors.surface.foreground)));
  
  // OpenChamber deliberately shares elevated between fields and floating UI.
  // Prefer a floating widget pair, then dropdown/input pairs. Keep the matching
  // foreground with the chosen background; do not mix unrelated VS Code roles.
  const elevatedSources = [
    ['editorWidget.background', 'editorWidget.foreground'],
    ['dropdown.background', 'dropdown.foreground'],
    ['input.background', 'input.foreground'],
  ] as const;
  const elevatedSource = elevatedSources.find(([key]) => palette.colors[key]);
  const elevated = elevatedSource ? read(elevatedSource[0], base.colors.surface.elevated) : base.colors.surface.elevated;
  const elevatedTextFallback = readableText(foreground, elevated, background);
  const elevatedForeground = elevatedSource ? read(elevatedSource[1], elevatedTextFallback) : elevatedTextFallback;
  
  // Secondary layout areas are surfaces, not inactive selections or bubbles.
  const muted = read('sideBar.background', read('panel.background', base.colors.surface.muted));
  
  // Muted foreground: secondary text - description foreground is perfect semantic match
  const mutedForeground = read('descriptionForeground', read('input.placeholderForeground', base.colors.surface.mutedForeground));
  
  const subtle = read('textBlockQuote.background', muted);
  
  // VS Code's status bar is a surface, not a modal backdrop.
  const overlay = base.colors.surface.overlay;

  // ===========================================
  // PRIMARY / ACCENT COLORS
  // ===========================================
  
  const accent = read('button.background', read('textLink.foreground', base.colors.primary.base));
  const accentHover = read('button.hoverBackground', accent);
  const accentForeground = palette.colors['button.background']
    ? read('button.foreground', onColor(accent, background))
    : onColor(accent, background);
  const accentMuted = applyAlpha(accent, 0.5);

  // ===========================================
  // INTERACTIVE COLORS
  // ===========================================
  
  // Border: Use widget.border (most generic), then input.border, panel.border
  // The shared adaptation pass caps ordinary border strength after mapping.
  const border = [
    palette.kind === 'high-contrast' || palette.highContrast ? read('contrastBorder', '') : '',
    read('widget.border', ''), read('input.border', ''),
    read('panel.border', ''), read('sideBar.border', ''),
    read('editorWidget.border', ''), read('contrastBorder', ''),
  ].find((value) => value && hasPaint(value));
  
  // For high-contrast or missing borders, derive from foreground
  const effectiveBorder = border || applyAlpha(foreground, isDark ? 0.25 : 0.2);
  
  // Hover/active backgrounds
  const hoverBg = read('toolbar.hoverBackground', read('list.hoverBackground', base.colors.interactive.hover));
  const activeBg = read('toolbar.activeBackground', hoverBg);
  
  // Selection
  // A sidebar selection can equal the floating-widget background. Prefer an
  // authored pair that remains distinguishable on all three shared surfaces.
  const selectionSources = [
    ['list.activeSelectionBackground', 'list.activeSelectionForeground'],
    ['menu.selectionBackground', 'menu.selectionForeground'],
    ['editor.selectionBackground', 'editor.selectionForeground'],
  ] as const;
  const candidates = selectionSources.filter(([token]) => palette.colors[token]);
  const selectionSource = candidates.find(([token]) => [background, muted, elevated].every((surface) => {
    const contrast = contrastRatio(read(token, ''), surface, background);
    return contrast === null || contrast > 1.01;
  })) ?? candidates[0];
  const selection = selectionSource ? read(selectionSource[0], base.colors.interactive.selection) : base.colors.interactive.selection;
  const selectionForeground = selectionSource ? read(selectionSource[1], foreground) : foreground;
  
  // Focus
  const focus = read('focusBorder', read('inputOption.activeBorder', accent));
  const focusRing = focus;
  
  // Cursor
  const cursor = read('editorCursor.foreground', base.colors.interactive.cursor);

  // ===========================================
  // STATUS COLORS
  // ===========================================
  
  const errorColor = read('editorError.foreground', read('testing.iconFailed', base.colors.status.error));
  const errorBg = readPaint('editorError.background', applyAlpha(errorColor, isDark ? 0.16 : 0.12));
  
  const warningColor = read('problemsWarningIcon.foreground', read('notificationsWarningIcon.foreground', read('editorWarning.foreground', base.colors.status.warning)));
  const warningBg = readPaint('editorWarning.background', applyAlpha(warningColor, isDark ? 0.16 : 0.12));
  
  const successColor = read('testing.iconPassed', read('gitDecoration.addedResourceForeground', base.colors.status.success));
  const successBg = applyAlpha(successColor, isDark ? 0.16 : 0.12);
  
  const infoColor = read('problemsInfoIcon.foreground', read('editorInfo.foreground', base.colors.status.info));
  const infoBg = readPaint('editorInfo.background', applyAlpha(infoColor, isDark ? 0.16 : 0.12));

  // ===========================================
  // SYNTAX / CODE COLORS
  // ===========================================
  
  const syntaxComment = read('editorLineNumber.foreground', mutedForeground);
  const syntaxString = read('textPreformat.foreground', read('terminal.ansiGreen', base.colors.syntax.base.string));
  const syntaxKeyword = read('terminal.ansiBlue', accent);
  const syntaxNumber = read('terminal.ansiYellow', base.colors.syntax.base.number);
  const syntaxFunction = read('terminal.ansiCyan', base.colors.syntax.base.function);
  const syntaxVariable = read('terminal.ansiMagenta', foreground);
  const syntaxType = read('terminal.ansiYellow', base.colors.syntax.base.type);

  // ===========================================
  // TOOLS SECTION - For tool cards, diffs, etc.
  // ===========================================
  
  // Keep the source tool outline until the shared role adaptation pass.
  const toolsBorder = read('chat.requestBorder', effectiveBorder);
  
  // Diff colors from VS Code diff editor
  const diffAddedBg = read('diffEditor.insertedLineBackground', read('diffEditor.insertedTextBackground', successBg));
  const diffRemovedBg = read('diffEditor.removedLineBackground', read('diffEditor.removedTextBackground', errorBg));
  const diffAddedColor = read('chat.linesAddedForeground', read('gitDecoration.addedResourceForeground', successColor));
  const diffRemovedColor = read('chat.linesRemovedForeground', read('gitDecoration.deletedResourceForeground', errorColor));
  const diffModifiedColor = read('gitDecoration.modifiedResourceForeground', infoColor);

  // ===========================================
  // CHAT COLORS
  // ===========================================
  
  // Prefer the authored chat bubble, with an elevated surface as the fallback.
  const userMessageBg = read('chat.requestBubbleBackground', read('chat.requestBackground', elevated));
  
  const theme: Theme = {
    ...base,
    metadata: {
      ...base.metadata,
      id: 'vscode-auto',
      name: 'VS Code Theme',
      description: 'Mirrors your current VS Code color theme',
      author: 'VS Code',
      version: '1.0.0',
      variant: isDark ? 'dark' : 'light',
      tags: ['vscode', 'auto'],
    },
    colors: {
      ...base.colors,
      primary: {
        base: accent,
        hover: accentHover,
        active: accentHover,
        foreground: accentForeground,
        muted: accentMuted,
      },
      surface: {
        background,
        foreground,
        muted,
        mutedForeground,
        elevated,
        elevatedForeground,
        overlay,
        subtle,
      },
      interactive: {
        border: effectiveBorder,
        borderHover: read('toolbar.hoverOutline', effectiveBorder),
        borderFocus: focus,
        selection,
        selectionForeground,
        focus,
        focusRing,
        cursor,
        hover: hoverBg,
        active: activeBg,
      },
      status: {
        error: errorColor,
        errorForeground: onColor(errorColor, background),
        errorBackground: errorBg,
        errorBorder: applyAlpha(errorColor, isDark ? 0.45 : 0.35),
        warning: warningColor,
        warningForeground: onColor(warningColor, background),
        warningBackground: warningBg,
        warningBorder: applyAlpha(warningColor, isDark ? 0.45 : 0.35),
        success: successColor,
        successForeground: onColor(successColor, background),
        successBackground: successBg,
        successBorder: applyAlpha(successColor, isDark ? 0.45 : 0.35),
        info: infoColor,
        infoForeground: onColor(infoColor, background),
        infoBackground: infoBg,
        infoBorder: applyAlpha(infoColor, isDark ? 0.45 : 0.35),
      },
      pr: base.colors.pr ? {
        ...base.colors.pr, open: successColor, closed: errorColor, draft: mutedForeground,
      } : undefined,
      syntax: {
        tokens: {},
        highlights: {
          diffAdded: diffAddedColor,
          diffAddedBackground: diffAddedBg,
          diffRemoved: diffRemovedColor,
          diffRemovedBackground: diffRemovedBg,
          diffModified: diffModifiedColor,
          diffModifiedBackground: applyAlpha(diffModifiedColor, isDark ? 0.16 : 0.12),
          lineNumber: read('editorLineNumber.foreground', mutedForeground),
          lineNumberActive: read('editorLineNumber.activeForeground', foreground),
        },
        base: {
          background: read('editor.background', background),
          foreground: read('editor.foreground', foreground),
          comment: syntaxComment,
          keyword: syntaxKeyword,
          string: syntaxString,
          number: syntaxNumber,
          function: syntaxFunction,
          variable: syntaxVariable,
          type: syntaxType,
          operator: accent,
        },
      },
      // Explicit tools section - cssGenerator will use these values directly
      tools: {
        border: toolsBorder,
        icon: read('icon.foreground', mutedForeground),
        title: foreground,
        description: applyAlpha(mutedForeground, 0.8),
        edit: {
          added: diffAddedColor,
          addedBackground: diffAddedBg,
          removed: diffRemovedColor,
          removedBackground: diffRemovedBg,
          modified: diffModifiedColor,
          modifiedBackground: applyAlpha(diffModifiedColor, isDark ? 0.16 : 0.12),
          lineNumber: syntaxComment,
        },
      },
      // Explicit chat section
      chat: {
        background,
        userMessage: foreground,
        userMessageBackground: userMessageBg,
        assistantMessage: foreground,
        assistantMessageBackground: background,
        timestamp: mutedForeground,
        divider: effectiveBorder,
        typing: read('chat.thinkingShimmer', mutedForeground),
        avatarBackground: read('chat.avatarBackground', background),
        avatarForeground: read('chat.avatarForeground', foreground),
        slashCommandBackground: read('chat.slashCommandBackground', accent),
        slashCommandForeground: read('chat.slashCommandForeground', accentForeground),
        inputWorkingBorderColor1: read('chat.inputWorkingBorderColor1', accent),
        inputWorkingBorderColor2: read('chat.inputWorkingBorderColor2', accentHover),
        inputWorkingBorderColor3: read('chat.inputWorkingBorderColor3', accentMuted),
      },
      // Markdown colors
      markdown: {
        link: read('textLink.foreground', accent),
        linkHover: read('textLink.activeForeground', accentHover),
        inlineCode: read('textPreformat.foreground', syntaxString),
        inlineCodeBackground: read('textPreformat.background', read('editor.background', background)),
        blockquote: foreground,
        blockquoteBackground: read('textBlockQuote.background', 'transparent'),
        blockquoteBorder: read('textBlockQuote.border', effectiveBorder),
        listMarker: applyAlpha(accent, 0.6),
      },
    },
  };
  adaptVSCodeRoles(theme, source.colors, palette.kind === 'high-contrast' || palette.highContrast === true);
  return theme;
};
