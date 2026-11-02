import { z } from 'zod';
import { runtimeFetch, type RuntimeFetchOptions } from '@/lib/runtime-fetch';

const memorySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  content: z.string(),
  observationType: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type SkynexMemory = z.infer<typeof memorySchema>;

export type SkynexMemoryNote = { what: string; why: string; where: string; learned: string };

const base = '/api/skynex/memory';
const memoriesSchema = z.object({ memories: z.array(memorySchema) });
const request = async <T>(url: string, directory: string, schema: z.ZodType<T>, init?: { method: 'POST'; body: SkynexMemoryNote | { query: string } }): Promise<T> => {
  const options: RuntimeFetchOptions = { query: { directory } };
  if (init !== undefined) {
    options.method = init.method;
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(init.body);
  }
  const response = await runtimeFetch(url, {
    ...options,
  });
  if (!response.ok) throw new Error('Memory request failed');
  return schema.parse(await response.json());
};

export const skynexMemoryApi = {
  list: async (directory: string): Promise<SkynexMemory[]> =>
    (await request(base, directory, memoriesSchema)).memories,
  save: async (directory: string, note: SkynexMemoryNote): Promise<void> => {
    await request(base, directory, z.object({ saved: z.literal(true) }), { method: 'POST', body: note });
  },
  recall: async (directory: string, query: string): Promise<SkynexMemory[]> =>
    (await request(`${base}/recall`, directory, memoriesSchema, { method: 'POST', body: { query } })).memories,
};
