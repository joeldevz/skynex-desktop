import { createProductAnalytics } from '@openchamber/web/server/lib/product-analytics.js';
import { isBoolean, isRecord } from '@openchamber/web/server/lib/shared/guards.js';
import { z } from 'zod';

const tokenSchema = z.string().regex(/^phc_[a-zA-Z0-9]{20,128}$/);

export const createDesktopProductAnalytics = ({ projectToken, version, platform, recordStartup = false, isEnterpriseMode, readPreference, writePreference, getInstallationId, fetchImpl = fetch }) => {
  let enabled = readPreference() !== false;
  let paused = false;
  let stopped = false;
  let epoch = 0;
  let preferenceWrites = Promise.resolve();
  const requests = new Set();
  const available = () => {
    try { return tokenSchema.safeParse(projectToken).success && isEnterpriseMode() === false; } catch { return false; }
  };
  const eligible = () => enabled && !paused && !stopped && available();
  const clear = () => {
    for (const controller of requests) controller.abort();
    requests.clear();
  };
  const record = (input) => {
    const currentEpoch = epoch;
    const eventEligible = () => currentEpoch === epoch && eligible();
    const analytics = createProductAnalytics({ projectToken, version, platform, isEnterpriseMode, isEnabled: eventEligible, getInstallationId: () => getInstallationId(eventEligible),
      send: async (payload) => {
        if (!eventEligible()) return false;
        const controller = new AbortController();
        requests.add(controller);
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetchImpl('https://eu.i.posthog.com/capture/', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
            redirect: 'error', signal: controller.signal,
          });
          return response.ok;
        } finally {
          clearTimeout(timeout);
          requests.delete(controller);
        }
      },
    });
    return analytics.record(input);
  };
  const stop = () => {
    stopped = true;
    epoch++;
    clear();
  };
  if (recordStartup && eligible()) void record({ event: 'app_opened' });
  return {
    settings: () => ({ enabled, available: available() }),
    recordInteraction(event) {
      if (event !== 'conversation_created' && event !== 'prompt_sent') return Promise.resolve(false);
      return record({ event });
    },
    recordFeature(args) {
      if (!isRecord(args) ||
          Object.keys(args).length !== 2 || !Object.hasOwn(args, 'feature') || !Object.hasOwn(args, 'action') ||
          !['chat', 'terminal', 'browser', 'whiteboards', 'skills', 'integrations'].includes(args.feature) ||
          !['opened', 'used'].includes(args.action)) return Promise.resolve(false);
      return record({ event: 'feature_used', feature: args.feature, action: args.action });
    },
    setEnabled(value) {
      if (!isBoolean(value)) throw new TypeError('enabled must be boolean');
      paused = true;
      epoch++;
      clear();
      if (!value) enabled = false;
      const pending = preferenceWrites.then(async () => {
        if (!value) enabled = false;
        await writePreference(value);
        enabled = value;
      });
      preferenceWrites = pending.catch(() => {});
      const settled = preferenceWrites;
      return pending.then(() => ({ enabled, available: available() })).finally(() => {
        if (preferenceWrites === settled) paused = false;
      });
    },
    stop,
  };
};
