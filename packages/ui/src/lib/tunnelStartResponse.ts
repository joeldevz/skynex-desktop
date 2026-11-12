import { z } from 'zod';

const tunnelMode = z.enum(['quick', 'managed-remote', 'managed-local', 'serve', 'funnel']);

export const tunnelStartResponseSchema = z.object({
  ok: z.boolean().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
  url: z.string().optional(),
  connectUrl: z.string().nullable().optional(),
  bootstrapExpiresAt: z.number().nullable().optional(),
  activeTunnelMode: tunnelMode.nullable().optional(),
  mode: tunnelMode.optional(),
  activeSessions: z.array(z.object({
    sessionId: z.string(),
    mode: tunnelMode.nullable(),
    status: z.enum(['active', 'inactive']),
    inactiveReason: z.string().nullable().optional(),
    createdAt: z.number(),
    lastSeenAt: z.number(),
    expiresAt: z.number(),
    publicUrl: z.string().nullable().optional(),
  })).optional(),
  managedRemoteTunnelTokenPresetIds: z.array(z.string()).optional(),
  localPort: z.number().optional(),
  replacedTunnel: z.boolean().optional(),
  revokedBootstrapCount: z.number().optional(),
  invalidatedSessionCount: z.number().optional(),
  approvalUrl: z.string().optional(),
});
