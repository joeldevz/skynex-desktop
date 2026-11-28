import { z } from 'zod';

const outcome = z.enum(['success', 'error', 'cancelled']);
const duration = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const events = z.discriminatedUnion('event', [
  z.object({ event: z.literal('app_opened') }).strict(),
  z.object({ event: z.literal('active_time_recorded'), active_seconds: z.number().int().min(1).max(60) }).strict(),
  z.object({ event: z.literal('conversation_created') }).strict(),
  z.object({ event: z.literal('prompt_sent') }).strict(),
  z.object({
    event: z.literal('feature_used'),
    feature: z.enum(['chat', 'terminal', 'browser', 'whiteboards', 'skills', 'integrations']),
    action: z.enum(['opened', 'used']),
  }).strict(),
  z.object({ event: z.literal('agent_turn_finished'), outcome, duration_ms: duration }).strict(),
  z.object({
    event: z.literal('agent_tool_finished'), outcome, duration_ms: duration,
    tool_category: z.enum(['read', 'write', 'search', 'execute', 'browser', 'other']),
  }).strict(),
]);

const tokenSchema = z.string().regex(/^phc_[a-zA-Z0-9]{20,128}$/);
const versionSchema = z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const platformSchema = z.enum(['darwin', 'linux', 'win32']);
const installationIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const analyticsCallbacks = z.tuple([z.function(), z.function(), z.function(), z.function()]);

export const createProductAnalytics = ({ projectToken, version, platform, isEnterpriseMode, isEnabled, getInstallationId, send } = {}) => ({
  async record(input) {
    try {
      const parsed = events.safeParse(input);
      if (!parsed.success || !tokenSchema.safeParse(projectToken).success ||
          !versionSchema.safeParse(version).success || !platformSchema.safeParse(platform).success ||
          !analyticsCallbacks.safeParse([isEnabled, isEnterpriseMode, getInstallationId, send]).success) return false;
      if (isEnabled() !== true || isEnterpriseMode() !== false) return false;

      const installationId = await getInstallationId();
      if (!installationIdSchema.safeParse(installationId).success ||
          isEnabled() !== true || isEnterpriseMode() !== false) return false;

      const { event, ...eventProperties } = parsed.data;
      const result = await send({
        api_key: projectToken,
        event,
        properties: {
          distinct_id: installationId,
          $geoip_disable: true,
          app_version: version,
          os_family: platform,
          event_schema_version: 1,
          ...eventProperties,
        },
      });
      return result !== false;
    } catch {
      return false;
    }
  },
});
