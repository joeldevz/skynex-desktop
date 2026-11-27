import { z } from 'zod';

export const annotationAnchorSchema = z.tuple([
  z.number().min(-1e7).max(1e7), z.number().min(-1e7).max(1e7),
  z.number().min(0).max(1e7), z.number().min(0).max(1e7),
  z.number().int().min(1).max(32768), z.number().int().min(1).max(32768),
]);

export type AnnotationAnchor = z.infer<typeof annotationAnchorSchema>;

export const annotationBubbleWidth = (viewportWidth: number) => Math.max(0, Math.min(420, viewportWidth - 24));

export function positionAnnotationBubble([x, y, width, height, viewportWidth, viewportHeight]: AnnotationAnchor, boxHeight: number) {
  const boxWidth = annotationBubbleWidth(viewportWidth);
  const clamp = (value: number, max: number) => Math.max(8, Math.min(value, max - 8));
  const below = y + height + 10;
  return {
    left: Math.round(clamp(x + (width - boxWidth) / 2, viewportWidth - boxWidth)),
    top: Math.round(clamp(below + boxHeight <= viewportHeight - 8 ? below : y - boxHeight - 10, viewportHeight - boxHeight)),
  };
}
