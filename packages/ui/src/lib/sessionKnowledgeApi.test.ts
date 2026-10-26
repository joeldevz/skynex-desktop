import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { syncSessionKnowledge } from './sessionKnowledgeApi';

const SPACE_DIRECTORY = '/spaces/a1b2c3d4e5f6/repo';

let request: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | null = null;

const capturePaths = (): string[] => {
  const paths: string[] = [];
  request = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    // The path and the directory header together say where the request goes.
    const directory = new Headers(init?.headers).get('x-opencode-directory');
    paths.push(`${new URL(input instanceof Request ? input.url : String(input), 'http://app.test').pathname} ${directory ?? '-'}`);
    return Response.json({ synced: true });
  });
  return paths;
};

afterEach(() => {
  request?.mockRestore();
  request = null;
});

// The session lives in the space's OpenCode, so a write or pin that reaches
// the host's server finds no session and changes nothing.
describe('session knowledge writes for a session in an isolated space', () => {
  test('the knowledge write reaches the server inside the space', async () => {
    const paths = capturePaths();
    await syncSessionKnowledge(SPACE_DIRECTORY, 'session-1');
    expect(paths).toEqual([`/api/session-knowledge/sync ${encodeURIComponent(SPACE_DIRECTORY)}`]);
  });

  test('a host session stays on the host', async () => {
    const paths = capturePaths();
    await syncSessionKnowledge('/home/me/repo', 'session-1');
    expect(paths).toEqual(['/api/session-knowledge/sync -']);
  });
});
