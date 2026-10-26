import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { skynexMemoryApi } from './skynexMemoryApi';
import { skynexTasksApi } from './skynexTasksApi';

let request: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | null = null;
afterEach(() => {
  request?.mockRestore();
  request = null;
});

const task = { id: 'task-1', title: 'Repair gates', steps: [], progress: { done: 0, total: 0 } };
const memory = { id: 'memory-1', title: null, content: 'Verified fact', observationType: null, createdAt: null };

describe('Skynex API response boundaries', () => {
  test('parses task lists and sends encoded mutation ids with the project and JSON body', async () => {
    const calls: { path: string; directory: string | null; method: string; body: BodyInit | null | undefined }[] = [];
    request = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
      calls.push({ path: url.pathname, directory: url.searchParams.get('directory'), method: init?.method ?? 'GET', body: init?.body });
      return Response.json(init?.method === 'POST' ? { task } : { tasks: [task] });
    });
    expect(await skynexTasksApi.list('/project')).toEqual([task]);
    expect(await skynexTasksApi.addStep('/project', 'task/1', 'Check output', 'step-1')).toEqual(task);
    expect(calls).toEqual([
      { path: '/api/skynex/tasks', directory: '/project', method: 'GET', body: undefined },
      { path: '/api/skynex/tasks/task%2F1/steps', directory: '/project', method: 'POST', body: JSON.stringify({ title: 'Check output', parent: 'step-1' }) },
    ]);
  });

  test('parses memory lists and recall responses and requires a confirmed save', async () => {
    request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ memories: [memory] }));
    expect(await skynexMemoryApi.list('/project')).toEqual([memory]);
    request.mockResolvedValue(Response.json({ memories: [memory] }));
    expect(await skynexMemoryApi.recall('/project', 'gates')).toEqual([memory]);
    request.mockResolvedValue(Response.json({ saved: false }));
    const note = { what: 'Gate repaired', why: 'Compatibility', where: 'Scripts', learned: 'Use tsc' };
    await expect(skynexMemoryApi.save('/project', note)).rejects.toThrow();
    request.mockResolvedValue(Response.json({ saved: true }));
    await skynexMemoryApi.save('/project', note);
    expect(request.mock.calls.at(-1)?.[1]?.body).toBe(JSON.stringify(note));
  });

  test('rejects malformed authoritative lists and failed HTTP responses', async () => {
    request = spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ tasks: [{ ...task, steps: 'invalid' }], memories: [{ ...memory, content: 42 }] }));
    await expect(skynexTasksApi.list('/project')).rejects.toThrow();
    await expect(skynexMemoryApi.list('/project')).rejects.toThrow();
    request.mockImplementation(async () => Response.json({}, { status: 503 }));
    await expect(skynexTasksApi.list('/project')).rejects.toThrow('Tasks request failed');
    await expect(skynexMemoryApi.list('/project')).rejects.toThrow('Memory request failed');
  });
});
