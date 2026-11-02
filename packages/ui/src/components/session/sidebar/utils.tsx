import { getCurrentIntlLocale } from '@/lib/i18n';
import { formatMessage, useI18nStore } from '@/lib/i18n/store';

import { normalizePath } from '@/lib/pathNormalization';
export { normalizePath };

export const selectExpandedParentKeysForContext = (
  previous: Set<string>,
  expanded: ReadonlySet<string>,
  context: 'project' | 'recent',
): Set<string> => {
  const prefix = `${context}:`;
  const next = new Set([...expanded].filter((key) => key.startsWith(prefix)));
  if (previous.size === next.size && [...next].every((key) => previous.has(key))) {
    return previous;
  }
  return next;
};

const t = (key: Parameters<typeof formatMessage>[1], params?: Parameters<typeof formatMessage>[2]) =>
  formatMessage(useI18nStore.getState().dictionary, key, params);

const formatDateLabel = (value: string | number) => {
  const targetDate = new Date(value);
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(targetDate, today)) {
    return t('common.date.today');
  }
  if (isSameDay(targetDate, yesterday)) {
    return t('common.date.yesterday');
  }
  const formatted = targetDate.toLocaleDateString(getCurrentIntlLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return formatted.replace(',', '');
};

export const formatSessionDateLabel = (updatedMs: number): string => {
  const today = new Date();
  const updatedDate = new Date(updatedMs);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(updatedDate, today)) {
    const diff = Date.now() - updatedMs;
    if (diff < 60_000) return t('common.relative.justNow');
    if (diff < 3_600_000) return t('common.relative.minutesAgoShort', { count: Math.floor(diff / 60_000) });
    return t('common.relative.hoursAgoShort', { count: Math.floor(diff / 3_600_000) });
  }

  return formatDateLabel(updatedMs);
};

export const formatSessionCompactDateLabel = (updatedMs: number): string => {
  const diff = Math.max(0, Date.now() - updatedMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diff < hour) {
    return t('common.relative.minutesAgoCompact', { count: Math.max(1, Math.floor(diff / minute)) });
  }
  if (diff < day) {
    return t('common.relative.hoursAgoCompact', { count: Math.floor(diff / hour) });
  }
  if (diff < week) {
    return t('common.relative.daysAgoCompact', { count: Math.floor(diff / day) });
  }
  if (diff < 5 * week) {
    return t('common.relative.weeksAgoCompact', { count: Math.floor(diff / week) });
  }
  if (diff < year) {
    return t('common.relative.monthsAgoCompact', { count: Math.floor(diff / month) });
  }
  return t('common.relative.yearsAgoCompact', { count: Math.floor(diff / year) });
};

export const isPathWithinProject = (directory?: string | null, projectPath?: string | null): boolean => {
  const normalizedDirectory = normalizePath(directory);
  const normalizedProjectPath = normalizePath(projectPath);
  return isNormalizedPathWithinProject(normalizedDirectory, normalizedProjectPath);
};

const isNormalizedPathWithinProject = (normalizedDirectory: string | null, normalizedProjectPath: string | null): boolean => {
  if (!normalizedDirectory || !normalizedProjectPath) return false;
  if (normalizedDirectory === normalizedProjectPath) return true;
  const prefix = normalizedProjectPath.endsWith('/') ? normalizedProjectPath : `${normalizedProjectPath}/`;
  return normalizedDirectory.startsWith(prefix);
};

// Folder names are shown exactly as they are on disk — no title-casing.
export const formatProjectLabel = (label: string): string => label.trim();
