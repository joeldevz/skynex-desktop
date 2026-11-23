import React from 'react';

import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { fetchWhiteboardImage } from './api';

/**
 * Pictures on boards never change once stored, so each is read once per
 * server and kept as an object URL that the canvas and the thumbnails share.
 */
const cache = new Map<string, Promise<string>>();

subscribeRuntimeEndpointChanged(() => {
  for (const entry of cache.values()) void entry.then((url) => URL.revokeObjectURL(url), () => undefined);
  cache.clear();
});

const loadImage = (boardId: string, imageId: string): Promise<string> => {
  const key = `${getRuntimeKey()}:${boardId}:${imageId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const loading = fetchWhiteboardImage(boardId, imageId).then((blob) => URL.createObjectURL(blob));
  // A failed read is forgotten, so the next view tries again.
  loading.catch(() => cache.delete(key));
  cache.set(key, loading);
  return loading;
};

export type WhiteboardImageState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'failed' };

/** The object URL of a board's picture once it has been read. */
export function useWhiteboardImage(boardId: string | undefined, imageId: string): WhiteboardImageState {
  const [state, setState] = React.useState<WhiteboardImageState>({ status: 'loading' });
  React.useEffect(() => {
    if (!boardId) return undefined;
    let active = true;
    setState({ status: 'loading' });
    loadImage(boardId, imageId).then(
      (url) => { if (active) setState({ status: 'ready', url }); },
      () => { if (active) setState({ status: 'failed' }); },
    );
    return () => { active = false; };
  }, [boardId, imageId]);
  return state;
}
