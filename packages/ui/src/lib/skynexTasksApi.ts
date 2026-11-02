import { z } from 'zod';
import { runtimeFetch, type RuntimeFetchOptions } from '@/lib/runtime-fetch';

const taskSchema = z.object({
  id: z.string(), title: z.string(),
  steps: z.array(z.object({ id: z.string(), title: z.string(), done: z.boolean(), parent: z.string().nullable().optional() })),
  progress: z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
});
export type SkynexTask = z.infer<typeof taskSchema>;
const base = '/api/skynex/tasks';
type Body = { title: string; parent?: string } | Record<string, never>;
const request = async <T>(url: string, directory: string, schema: z.ZodType<T>, body?: Body): Promise<T> => {
  const options: RuntimeFetchOptions = { query: { directory } };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await runtimeFetch(url, {
    ...options,
  });
  if (!response.ok) throw new Error('Tasks request failed');
  return schema.parse(await response.json());
};
const mutation = async (url: string, directory: string, body: Body) =>
  (await request(url, directory, z.object({ task: taskSchema }), body)).task;
export const skynexTasksApi = {
  list: async (directory: string) => (await request(base, directory, z.object({ tasks: z.array(taskSchema) }))).tasks,
  create: (directory: string, title: string) => mutation(base, directory, { title }),
  addStep: (directory: string, id: string, title: string, parent?: string) => mutation(`${base}/${encodeURIComponent(id)}/steps`, directory, parent ? { title, parent } : { title }),
  completeStep: (directory: string, id: string, step: string) => mutation(`${base}/${encodeURIComponent(id)}/steps/${encodeURIComponent(step)}/complete`, directory, {}),
};
