import { describe, expect, test } from 'bun:test';

import { applyOpsLocally } from '@/stores/useWhiteboardsStore';
import type { Workspace } from '@/lib/workspaces/model';
import { boardBounds, boardTitleFrom, routeArrows, describeSelectionForAgent, elementsInView, patchElement, whiteboardSchema, type Whiteboard } from './model';
import { workspacesForDirectory } from './workspaces';

const board: Whiteboard = whiteboardSchema.parse({
  id: 'wb_1',
  workspaceId: 'ws_1',
  title: 'Checkout flow',
  revision: 4,
  createdAt: 1,
  updatedAt: 2,
  lastChange: null,
  canUndo: false,
  elements: [
    { id: 'a', kind: 'block', rev: 1, x: 0, y: 0, w: 100, h: 50, text: 'Cart', form: 'rounded' },
    { id: 'b', kind: 'block', rev: 1, x: 300, y: 0, w: 100, h: 50, text: 'Pay' },
    { id: 'n', kind: 'note', rev: 2, x: 0, y: 200, w: 120, h: 80, text: 'Ask   about\ncoupons' },
    { id: 'ab', kind: 'arrow', rev: 3, from: 'a', to: 'b', text: 'next' },
  ],
});

describe('whiteboard model', () => {
  test('a board from a server before comments reads with none, and comments parse with their threads', () => {
    const base = { id: 'wb_a', workspaceId: 'w', title: 'A', revision: 1, createdAt: 1, updatedAt: 1, elements: [], lastChange: null, canUndo: false };
    expect(whiteboardSchema.parse(base).comments).toEqual([]);
    const comment = { id: 'cm_0000000001', anchor: { elementId: 'card', x: 1, y: 2 }, resolved: false, createdAt: 1, updatedAt: 1, entries: [{ id: 'ce_0000000001', author: 'user', text: 'hola', at: 1, sent: true }] };
    expect(whiteboardSchema.parse({ ...base, comments: [comment] }).comments[0]?.entries[0]).toMatchObject({ author: 'user', sent: true });
  });

  test('bounds cover every box and ignore arrows', () => {
    expect(boardBounds(board.elements)).toEqual({ x: 0, y: 0, w: 400, h: 280 });
    expect(boardBounds([])).toBeNull();
  });

  test('a board asked for by description is titled with its first line, cut at a word', () => {
    expect(boardTitleFrom('  el flujo de   login\ncon detalles')).toBe('el flujo de login');
    expect(boardTitleFrom('\n\nArquitectura')).toBe('Arquitectura');
    const long = 'Un diagrama del ciclo de vida de una sesión, desde que se crea hasta que se archiva';
    const title = boardTitleFrom(long);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
    expect(title.slice(0, -1).endsWith(' ')).toBe(false);
  });

  test('arrows run straight or turn at right angles, end on box edges and go around other boxes', () => {
    // The TDD cycle: Rojo on top, Verde bottom right, Refactor bottom left.
    const boxes = new Map([
      ['rojo', { x: 185, y: 60, w: 155, h: 75 }],
      ['verde', { x: 310, y: 260, w: 150, h: 75 }],
      ['refactor', { x: 60, y: 260, w: 155, h: 75 }],
      ['middle', { x: 230, y: 160, w: 40, h: 40 }],
    ]);
    const routes = routeArrows([
      { id: 'r-v', from: 'rojo', to: 'verde' },
      { id: 'v-f', from: 'verde', to: 'refactor' },
      { id: 'f-r', from: 'refactor', to: 'rojo' },
    ], boxes);
    // Verde to Refactor sit side by side: one straight run between their facing sides.
    expect(routes.get('v-f')?.points).toEqual([{ x: 310, y: 297.5 }, { x: 215, y: 297.5 }]);
    // Rojo and Verde only overlap by a sliver: the arrow leaves Rojo's side and turns down into Verde's top.
    expect(routes.get('r-v')?.points).toEqual([{ x: 340, y: 97.5 }, { x: 385, y: 97.5 }, { x: 385, y: 260 }]);
    for (const route of routes.values()) {
      for (let i = 1; i < route.points.length; i += 1) {
        const [a, b] = [route.points[i - 1], route.points[i]];
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
      expect(route.points.length).toBeLessThanOrEqual(4);
    }
    // Nothing runs through the box in the middle.
    const middle = boxes.get('middle');
    for (const route of routes.values()) {
      for (let i = 1; i < route.points.length; i += 1) {
        const [a, b] = [route.points[i - 1], route.points[i]];
        const inside = (p: { x: number; y: number }) => middle && p.x > middle.x && p.x < middle.x + middle.w && p.y > middle.y && p.y < middle.y + middle.h;
        expect(inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBe(false);
      }
    }
    // Two arrows on Refactor do not share its right side.
    const refactorRight = [...routes.values()].filter((route) => route.points.some((p) => p.x === 215 && p.y > 260 && p.y < 335));
    expect(refactorRight.length).toBeLessThanOrEqual(1);
  });

  test('a patch only touches fields the element kind has', () => {
    const arrow = board.elements[3];
    expect(patchElement(arrow, { x: 10, text: 'then' })).toEqual({ ...arrow, text: 'then' });
    const block = board.elements[0];
    expect(patchElement(block, { form: 'diamond', size: 'title', x: 5 })).toEqual({ ...block, form: 'diamond', x: 5 });
  });

  test('a picture keeps its image when patched, and takes no color', () => {
    const image = whiteboardSchema.parse({ ...board, elements: [{ id: 'i', kind: 'image', rev: 1, x: 0, y: 0, w: 100, h: 50, text: '', imageId: 'img_1' }] }).elements[0];
    expect(patchElement(image, { x: 10, text: 'Login', color: 'red' })).toEqual({ ...image, x: 10, text: 'Login' });
  });

  test('the agent reads the board and the selected elements by id', () => {
    const text = describeSelectionForAgent(board, ['n', 'ab', 'missing']);
    expect(text).toContain('boardId wb_1');
    expect(text).toContain('revision 4');
    expect(text).toContain('- n (note): Ask about coupons');
    expect(text).toContain('- ab (arrow a -> b): next');
    expect(text).not.toContain('missing');
    expect(describeSelectionForAgent(board, [])).toContain('whole board');
  });
});

describe('elements in view', () => {
  test('draws boxes that touch the view, arrows spanning it, and always the kept ones', () => {
    const elements = whiteboardSchema.parse({ ...board, elements: [
      { id: 'near', kind: 'block', rev: 1, x: 0, y: 0, w: 100, h: 50, text: '' },
      { id: 'far', kind: 'block', rev: 1, x: 5000, y: 5000, w: 100, h: 50, text: '' },
      { id: 'farther', kind: 'block', rev: 1, x: 9000, y: 9000, w: 100, h: 50, text: '' },
      { id: 'across', kind: 'arrow', rev: 1, from: 'near', to: 'far', text: '' },
      { id: 'away', kind: 'arrow', rev: 1, from: 'far', to: 'farther', text: '' },
    ] }).elements;
    const view = { x: -50, y: -50, w: 400, h: 300 };
    const ids = (keep: string[]) => elementsInView(elements, view, (box) => box, new Set(keep)).map((element) => element.id);
    expect(ids([])).toEqual(['near', 'across']);
    expect(ids(['farther'])).toEqual(['near', 'farther', 'across']);
    // A box dragged into view is drawn where it is being dragged to.
    expect(elementsInView(elements, view, (box) => (box.id === 'far' ? { ...box, x: 10, y: 10 } : box), new Set()).map((element) => element.id)).toContain('far');
  });
});

describe('local application of changes', () => {
  test('adds, updates and deletes like the server, deleting arrows with their ends', () => {
    const next = applyOpsLocally(board, [
      { op: 'add', element: { id: 'c', kind: 'text', x: 0, y: -80, w: 200, h: 40, text: 'Title', size: 'title' } },
      { op: 'update', id: 'b', set: { x: 320, text: 'Payment' } },
      { op: 'delete', id: 'a' },
    ]);
    expect(next.elements.map((element) => element.id)).toEqual(['b', 'n', 'c']);
    expect(next.elements[0]).toMatchObject({ x: 320, text: 'Payment' });
    expect(next.elements[2]).toMatchObject({ kind: 'text', rev: 5 });
    expect(board.elements).toHaveLength(4);
  });
});

describe('workspaces of a folder', () => {
  const workspace = (id: string, ...paths: string[]): Workspace => ({
    id, name: id, description: '', defaults: {}, folders: paths.map((path, index) => ({ id: `${id}-${index}`, path, role: '' })),
  });
  const workspaces = [workspace('one', '/repo/app'), workspace('two', '/repo'), workspace('three', '/repo/application')];

  test('a folder belongs to every workspace with a folder that is it or contains it', () => {
    expect(workspacesForDirectory(workspaces, '/repo/app/src').map((entry) => entry.id)).toEqual(['one', 'two']);
    expect(workspacesForDirectory(workspaces, '/repo/application').map((entry) => entry.id)).toEqual(['two', 'three']);
    expect(workspacesForDirectory(workspaces, '/elsewhere')).toEqual([]);
    expect(workspacesForDirectory(workspaces, null)).toEqual([]);
  });
});
