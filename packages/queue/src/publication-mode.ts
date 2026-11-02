/**
 * Publication mode for the shared worker path and channel connectors.
 *
 * PUBLICATION_MODE=mock (default) — no outbound posts. MockPublicationPublisher
 * and BaseConnector both return mock_ ids and https://mock.geo.local URLs.
 * PUBLICATION_MODE=real — connector doPublish may call the platform.
 *   The shared executePublication path (demo API + BullMQ) does not invent a
 *   live URL; it fails closed with REAL_PUBLICATION_NOT_WIRED.
 *
 * When PUBLICATION_MODE is unset, EXTERNAL_PUBLISHING_ENABLED=true is the
 * legacy alias for real. Any other explicit value fails closed to mock.
 */

export const PUBLICATION_MODES = ['mock', 'real'] as const;
export type PublicationMode = (typeof PUBLICATION_MODES)[number];

export const REAL_PUBLICATION_NOT_WIRED = 'REAL_PUBLICATION_NOT_WIRED';

export function resolvePublicationMode(env: NodeJS.ProcessEnv = process.env): PublicationMode {
  const explicit = env.PUBLICATION_MODE?.trim().toLowerCase();
  if (explicit === 'mock' || explicit === 'real') return explicit;
  if (explicit) return 'mock';
  return env.EXTERNAL_PUBLISHING_ENABLED === 'true' ? 'real' : 'mock';
}

export function outboundPublishEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolvePublicationMode(env) === 'real';
}
