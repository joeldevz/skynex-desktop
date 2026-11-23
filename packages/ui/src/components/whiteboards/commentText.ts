import type { I18nContextValue } from '@/lib/i18n/react-context';
import type { I18nKey } from '@/lib/i18n';
import type { CommentTarget } from '@/lib/whiteboards/comments';
import type { WhiteboardElement } from '@/lib/whiteboards/model';

const KIND_LABEL = {
  block: 'whiteboards.canvas.tool.block',
  note: 'whiteboards.canvas.tool.note',
  text: 'whiteboards.canvas.tool.text',
  section: 'whiteboards.canvas.tool.section',
  arrow: 'whiteboards.canvas.tool.arrow',
  image: 'whiteboards.canvas.tool.image',
} satisfies Record<WhiteboardElement['kind'], I18nKey>;


const items = (t: I18nContextValue['t'], count: number): string => (count === 1 ? t('whiteboards.comments.targetOneItem') : t('whiteboards.comments.targetItems', { count: String(count) }));

/** The line above a comment: what it is about ("Section “1. TDD cycle” · 6 items", "Card “2. Green”", "A point on the board"). */
export const commentTargetLabel = (t: I18nContextValue['t'], target: CommentTarget): string => {
  if (target.kind === 'point') return t('whiteboards.comments.targetPoint');
  if (target.kind === 'group') return items(t, target.count);
  if (target.kind === 'area') return target.contains > 0 ? `${t('whiteboards.comments.targetArea')} · ${items(t, target.contains)}` : t('whiteboards.comments.targetArea');
  const kind = t(KIND_LABEL[target.elementKind]);
  const named = target.name ? t('whiteboards.comments.targetNamed', { kind, name: target.name }) : kind;
  return target.contains > 0 ? `${named} · ${items(t, target.contains)}` : named;
};
