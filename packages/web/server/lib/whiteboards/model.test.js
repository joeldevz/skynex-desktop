import { describe, expect, it } from 'vitest';
import { applyOps, crowdedArrowLabels, describeCrowdedLabels, undoLast, WhiteboardError, WHITEBOARD_LIMITS } from './model.js';

const board = (elements = []) => ({ id: 'wb_test', workspaceId: 'w', title: 'Test', revision: 1, createdAt: 1, updatedAt: 1, elements, lastChange: null, history: [] });
const block = (id, x = 1) => ({ id, kind: 'block', x, y: 1, w: 100, h: 40, text: id, rev: 1 });

describe('whiteboard model', () => {
  it('blocks, notes and texts take a size and an alignment; other kinds refuse them', () => {
    const start = board([block('b'), { id: 'n', kind: 'note', x: 0, y: 0, w: 100, h: 100, text: '', rev: 1 }, { id: 's', kind: 'section', x: 0, y: 0, w: 100, h: 100, text: '', rev: 1 }]);
    const result = applyOps(start, [
      { op: 'update', id: 'b', set: { size: 'heading', align: 'start' } },
      { op: 'update', id: 'n', set: { align: 'center', size: 'small' } },
      { op: 'add', element: { id: 't', kind: 'text', x: 0, y: 0, w: 100, h: 40, text: '**Hola**', align: 'end' } },
    ], { baseRevision: 1, actor: 'user', now: 2 });
    expect(result.board.elements.find((element) => element.id === 'b')).toMatchObject({ size: 'heading', align: 'start' });
    expect(result.board.elements.find((element) => element.id === 'n')).toMatchObject({ size: 'small', align: 'center' });
    expect(result.board.elements.find((element) => element.id === 't')).toMatchObject({ align: 'end', text: '**Hola**' });
    expect(() => applyOps(start, [{ op: 'update', id: 's', set: { align: 'center' } }], { baseRevision: 1, actor: 'user', now: 2 })).toThrow(WhiteboardError);
    expect(() => applyOps(start, [{ op: 'update', id: 'b', set: { align: 'middle' } }], { baseRevision: 1, actor: 'user', now: 2 })).toThrow(WhiteboardError);
  });

  it('names labelled arrows whose boxes are too close for the label, and only those', () => {
    const elements = [
      { id: 'user', kind: 'block', x: 0, y: 0, w: 200, h: 90, text: 'Usuario', rev: 1 },
      { id: 'idp', kind: 'block', x: 252, y: 0, w: 200, h: 90, text: 'Proveedor', rev: 1 },
      { id: 'app', kind: 'block', x: 652, y: 0, w: 200, h: 90, text: 'Aplicación', rev: 1 },
      { id: 'below', kind: 'block', x: 0, y: 120, w: 200, h: 90, text: 'Debajo', rev: 1 },
      { id: 'tight', kind: 'arrow', from: 'user', to: 'idp', text: 'Redirección', rev: 1 },
      { id: 'roomy', kind: 'arrow', from: 'idp', to: 'app', text: 'Respuesta', rev: 1 },
      { id: 'bare', kind: 'arrow', from: 'user', to: 'idp', text: '', rev: 1 },
      { id: 'down', kind: 'arrow', from: 'user', to: 'below', text: 'luego', rev: 1 },
    ];
    const crowded = crowdedArrowLabels(elements);
    expect(crowded.map(({ arrowId }) => arrowId)).toEqual(['tight', 'down']);
    expect(crowded[0]).toMatchObject({ gap: 52, axis: 'x' });
    expect(crowded[0].needed).toBeGreaterThan(100);
    expect(crowded[1]).toMatchObject({ gap: 30, needed: 60, axis: 'y' });
    // Only arrows touching what changed are reported.
    expect(crowdedArrowLabels(elements, ['app'])).toEqual([]);
    expect(crowdedArrowLabels(elements, ['below']).map(({ arrowId }) => arrowId)).toEqual(['down']);
    expect(describeCrowdedLabels(crowded)[0]).toContain('Arrow tight ("Redirección")');
  });

  it('adds generated ids and supports arrows to earlier same-batch adds', () => {
    const generated = applyOps(board(), [{ op: 'add', element: { kind: 'block', x: 0, y: 0, w: 100, h: 50, text: 'Generated' } }], { baseRevision: 1, actor: 'agent', now: 2 });
    expect(generated.elementIds[0]).toMatch(/^el_[a-z0-9]{10}$/);
    const result = applyOps(board(), [
      { op: 'add', element: { id: 'a', kind: 'block', x: 0, y: 0, w: 100, h: 50, text: 'A' } },
      { op: 'add', element: { id: 'b', kind: 'note', x: 1, y: 2, w: 100, h: 50, text: 'B' } },
      { op: 'add', element: { id: 'edge', kind: 'arrow', from: 'a', to: 'b', text: '' } },
    ], { baseRevision: 1, actor: 'agent', now: 2 });
    expect(result.elementIds).toHaveLength(3);
    expect(result.board.elements.at(-1)).toMatchObject({ id: 'edge', kind: 'arrow', from: 'a', to: 'b' });
    expect(result.board.revision).toBe(2);
  });

  it('rejects stale update and delete, cascades arrows, and undoes add/update/delete', () => {
    const initial = board([block('a'), block('b', 2), { id: 'line', kind: 'arrow', from: 'a', to: 'b', text: '', rev: 1 }]);
    const updated = applyOps(initial, [{ op: 'update', id: 'a', set: { text: 'new' } }], { baseRevision: 1, actor: 'user' }).board;
    expect(() => applyOps(updated, [{ op: 'update', id: 'a', set: { text: 'stale' } }], { baseRevision: 1, actor: 'agent' })).toThrowError(WhiteboardError);
    expect(() => applyOps(updated, [{ op: 'delete', id: 'a' }], { baseRevision: 1, actor: 'agent' })).toThrowError(WhiteboardError);
    expect(undoLast(updated, { actor: 'agent' }).board.elements.find(({ id }) => id === 'a').text).toBe('a');
    const deleted = applyOps(initial, [{ op: 'delete', id: 'a' }], { baseRevision: 1, actor: 'agent' }).board;
    expect(deleted.elements.map(({ id }) => id)).toEqual(['b']);
    expect(undoLast(deleted).board.elements.map(({ id }) => id)).toEqual(['a', 'b', 'line']);
    const added = applyOps(board(), [{ op: 'add', element: { id: 'c', kind: 'block', x: 1, y: 1, w: 100, h: 40, text: 'c' } }], { baseRevision: 1, actor: 'agent' }).board;
    expect(undoLast(added).board.elements).toEqual([]);
  });

  it('rejects limits, unknown keys and unconfirmed whole-board removal', () => {
    expect(WHITEBOARD_LIMITS.elements).toBe(800);
    expect(() => applyOps(board(Array.from({ length: 800 }, (_, i) => block(`e${i}`))), [{ op: 'add', element: { kind: 'block', x: 0, y: 0, w: 8, h: 8, text: '' } }], { baseRevision: 1, actor: 'user' })).toThrowError(WhiteboardError);
    expect(() => applyOps(board(), [{ op: 'add', element: { kind: 'block', x: 0, y: 0, w: 8, h: 8, text: '', typo: 1 } }], { baseRevision: 1, actor: 'user' })).toThrowError(WhiteboardError);
    const populated = board([block('a'), block('b'), block('c')]);
    expect(() => applyOps(populated, populated.elements.map(({ id }) => ({ op: 'delete', id })), { baseRevision: 1, actor: 'user' })).toThrowError(expect.objectContaining({ code: 'needs-confirmation' }));
    expect(applyOps(populated, populated.elements.map(({ id }) => ({ op: 'delete', id })), { baseRevision: 1, actor: 'user', confirmReplace: true }).board.elements).toEqual([]);
  });

  it('caps undo history and detects undo conflicts', () => {
    let current = board();
    for (let i = 0; i < 32; i += 1) current = applyOps(current, [{ op: 'add', element: { id: `e${i}`, kind: 'block', x: i, y: 0, w: 8, h: 8, text: '' } }], { baseRevision: current.revision, actor: 'user' }).board;
    expect(current.history).toHaveLength(30);
    expect(() => undoLast({ ...current, elements: current.elements.map((item) => item.id === 'e31' ? { ...item, rev: current.revision + 1 } : item) })).toThrowError(WhiteboardError);
  });
});
