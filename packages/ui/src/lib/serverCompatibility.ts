import { z } from 'zod';
import { runtimeFetch } from './runtime-fetch';

const versionResponse = z.object({
  openchamberVersion: z.string(),
  compatibility: z.object({
    capabilities: z.array(z.string()).catch([]),
  }).catch({ capabilities: [] }),
});

type ConnectedServerCompatibility = {
  version: string;
  supportsOpenCode2: boolean;
};

/**
 * Product version and explicit protocol support over the active runtime transport.
 * Unavailable metadata is not evidence of a legacy server.
 */
export const fetchConnectedServerCompatibility = async (
  signal: AbortSignal,
  request: typeof runtimeFetch = runtimeFetch,
): Promise<ConnectedServerCompatibility | null> => {
  try {
    const response = await request('/api/version', {
      signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json().catch(() => null);
    const parsedVersion = versionResponse.safeParse(payload);
    if (!parsedVersion.success) return null;
    const version = parsedVersion.data.openchamberVersion.trim();
    if (!version) return null;
    const supportsOpenCode2 = parsedVersion.data.compatibility.capabilities.includes('opencode.api.v2');
    return { version, supportsOpenCode2 };
  } catch {
    return null;
  }
};

/**
 * Unmarked legacy OpenChamber servers answer OpenCode 2 routes with a web page.
 * An unreadable product version remains inconclusive.
 */
export const isServerBeforeOpenCode2 = (version: string, supportsOpenCode2 = false): boolean => {
  if (supportsOpenCode2) return false;
  const major = /^(\d+)\./.exec(version)?.[1];
  return major !== undefined && Number(major) < 2;
};
