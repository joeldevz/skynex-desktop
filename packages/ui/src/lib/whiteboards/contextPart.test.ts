import { describe, expect, test } from 'bun:test';

import { createContextPart, formatContextText, readContextPart, type WhiteboardContext } from '@/lib/messages/contextParts';

const payload: WhiteboardContext = {
  kind: 'whiteboard',
  boardId: 'wb_1',
  workspaceId: 'ws_1',
  title: 'Checkout',
  selected: [{ id: 'a', kind: 'block', text: 'Cart' }],
};

describe('whiteboard context part', () => {
  test('a request from a board comes back from the server as the board it named', () => {
    const part = createContextPart(payload, 'agent text');
    expect(part.text).toBe('agent text');
    expect(readContextPart({ type: 'text', metadata: part.metadata })).toEqual(payload);
  });

  test('without its own text the agent still reads the board and the selection', () => {
    const text = formatContextText(payload);
    expect(text).toContain('boardId wb_1');
    expect(text).toContain('- a (block): Cart');
    expect(formatContextText({ ...payload, selected: [] })).toContain('whole board');
  });

  test('a request from a board comment names the comment, comes back with it, and tells the agent to answer in its thread', () => {
    const fromComment = { ...payload, commentId: 'cm_abcdefghij' };
    const part = createContextPart(fromComment, formatContextText(fromComment));
    expect(readContextPart({ type: 'text', metadata: part.metadata })).toEqual(fromComment);
    expect(part.text).toContain('whiteboard.comment.reply');
    expect(part.text).toContain('cm_abcdefghij');
    // An id that is not a comment id is not read back as one.
    expect(readContextPart({ type: 'text', metadata: createContextPart({ ...payload, commentId: '../x' }, '').metadata })).toBeNull();
  });
});
