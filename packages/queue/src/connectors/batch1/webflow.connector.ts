import { BaseConnector } from '../base.connector';
import type {
  ChannelCapabilityDescriptor,
  ChannelCategory,
  ConnectionValidationResult,
  DeleteResult,
  NormalizedPublishContent,
  PublicationStatusResult,
  PublishOptions,
  PublishResult,
  StoredCredential,
} from '../types';
import { normalizeHttpError } from '../errors';

export class WebflowConnector extends BaseConnector {
  readonly channel = 'WEBFLOW' as const;
  readonly category: ChannelCategory = 'OWNED_SITE';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'WEBFLOW',
      category: 'OWNED_SITE',
      displayName: 'Webflow',
      officialDocsUrl: 'https://developers.webflow.com/data/reference/cms/create-item',
      authorizationType: 'API_KEY', // API token or OAuth2
      implementationStatus: 'READY',
      supportsText: true,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: false,
      supportsWebhook: true,
      titleMax: 256,
      bodyMax: 50000,
      prerequisites: ['Webflow API Token or OAuth, Collection ID'],
      assetLimits: {
        maxImages: 25,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
      },
    };
  }

  private getAuthHeader(credential: StoredCredential): string {
    const token = credential.apiKey || credential.accessToken;
    return `Bearer ${token}`;
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const res = await fetch('https://api.webflow.com/v2/token/authorized_by', {
        headers: { Authorization: this.getAuthHeader(credential) },
      });
      if (!res.ok) {
        return { valid: false, errorMessage: `Webflow auth failed: ${res.statusText}` };
      }
      const data = (await res.json()) as { id?: string; firstName?: string; lastName?: string };
      return {
        valid: true,
        accountId: data.id,
        accountName: [data.firstName, data.lastName].filter(Boolean).join(' ') || 'Webflow Workspace',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Webflow connection error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const collectionId = credential.channelId || (credential.extra?.collectionId as string) || 'default-collection';
      const itemData = {
        fieldData: {
          name: content.title || 'Untitled Post',
          slug: (content.title || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          'post-body': content.body,
          'post-summary': content.summary || '',
        },
      };

      const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items/live`, {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(credential),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(itemData),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Webflow publish failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: data.id,
        externalUrl: `https://webflow.com/item/${data.id}`,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Webflow network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async getPublicationStatus(externalId: string, credential: StoredCredential): Promise<PublicationStatusResult> {
    try {
      const collectionId = credential.channelId || (credential.extra?.collectionId as string) || 'default-collection';
      const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items/${externalId}`, {
        headers: { Authorization: this.getAuthHeader(credential) },
      });
      if (!res.ok) {
        return { externalId, status: 'FAILED', errorMessage: `Webflow status returned ${res.status}` };
      }
      return { externalId, status: 'PUBLISHED' };
    } catch (e) {
      return { externalId, status: 'UNKNOWN', errorMessage: e instanceof Error ? e.message : 'Query error' };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const collectionId = credential.channelId || (credential.extra?.collectionId as string) || 'default-collection';
      const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: this.getAuthHeader(credential) },
      });
      return { ok: res.ok, errorMessage: res.ok ? undefined : `Delete returned ${res.status}` };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
