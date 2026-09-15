import type { Channel } from '@geo/database';

export type ChannelCategory =
  | 'OWNED_SITE'
  | 'SOCIAL'
  | 'VIDEO'
  | 'LONG_FORM'
  | 'COMMUNITY'
  | 'MESSAGING'
  | 'LOCAL_BUSINESS'
  | 'SEARCH_SURFACE';

export type AuthorizationType = 'NONE' | 'API_KEY' | 'OAUTH2';

export type ImplementationStatus =
  | 'READY'
  | 'READY_FOR_CREDENTIALS'
  | 'REQUIRES_APP_REVIEW'
  | 'RESTRICTED'
  | 'MANUAL_ONLY'
  | 'UNAVAILABLE';

export type SchedulingSupport = 'NATIVE_SCHEDULING' | 'GEOLENS_SCHEDULING' | 'NONE';

export interface ChannelCapabilityDescriptor {
  channel: Channel;
  category: ChannelCategory;
  displayName: string;
  officialDocsUrl: string;
  authorizationType: AuthorizationType;
  implementationStatus: ImplementationStatus;
  supportsText: boolean;
  supportsImages: boolean;
  supportsVideo: boolean;
  supportsCarousel: boolean;
  supportsScheduling: SchedulingSupport;
  supportsDelete: boolean;
  supportsEdit: boolean;
  supportsStatusQuery: boolean;
  supportsAnalytics: boolean;
  supportsWebhook: boolean;
  titleMax: number;
  bodyMax: number;
  prerequisites: string[];
  assetLimits: {
    maxImages?: number;
    maxVideoSizeMb?: number;
    allowedMimeTypes?: string[];
  };
}

export interface NormalizedPublishContent {
  title?: string | null;
  body: string;
  summary?: string | null;
  tags?: string[];
  topic?: string | null;
  coverUrl?: string | null;
  canonicalUrl?: string | null;
  assets?: Array<{
    type: 'IMAGE' | 'VIDEO' | 'COVER' | 'AUDIO' | string;
    url: string;
    mimeType: string;
    sizeBytes?: number;
    externalId?: string;
  }>;
  metadata?: Record<string, unknown>;
}

export interface StoredCredential {
  credentialRef: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string | null;
  baseUrl?: string;
  username?: string;
  password?: string;
  webhookUrl?: string;
  chatId?: string;
  channelId?: string;
  accountId?: string;
  scopes?: string[];
  extra?: Record<string, unknown>;
}

export interface PublishOptions {
  dryRun?: boolean;
  scheduledAt?: Date;
  confirm?: boolean;
  idempotencyKey?: string;
}

export interface PublishResult {
  ok: boolean;
  publisher: 'mock' | 'real';
  externalId?: string;
  externalUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  durationMs: number;
  rawResponse?: Record<string, unknown>;
}

export interface ConnectionValidationResult {
  valid: boolean;
  accountName?: string;
  accountId?: string;
  scopes?: string[];
  errorMessage?: string;
}

export interface ContentValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface AssetUploadInput {
  assetId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface AssetUploadResult {
  ok: boolean;
  externalMediaId: string;
  externalMediaUrl?: string;
  errorMessage?: string;
}

export interface PublicationStatusResult {
  externalId: string;
  status: 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'UNKNOWN';
  externalUrl?: string;
  errorMessage?: string;
}

export interface DeleteResult {
  ok: boolean;
  errorMessage?: string;
}

export interface DistributionMetric {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;
  clicks?: number;
  followers?: number;
  watchTimeSeconds?: number;
  lastUpdatedAt: Date;
}

export interface DistributionMetricsResult {
  externalId: string;
  metrics: DistributionMetric;
}

export interface OAuthContext {
  organizationId: string;
  projectId: string;
  redirectUri: string;
  state: string;
  clientId?: string;
  clientSecret?: string;
}

export interface OAuthAuthorizationUrl {
  authorizationUrl: string;
  state: string;
}

export interface NormalizedCredentialResult {
  credentialRef: string;
  credential: StoredCredential;
  expiresInSeconds?: number;
  scopes?: string[];
}

export interface ChannelConnector {
  readonly channel: Channel;
  readonly category: ChannelCategory;

  getCapabilities(): ChannelCapabilityDescriptor;

  beginAuthorization?(context: OAuthContext): Promise<OAuthAuthorizationUrl>;

  exchangeAuthorizationCode?(code: string, context: OAuthContext): Promise<NormalizedCredentialResult>;

  refreshCredential?(credential: StoredCredential): Promise<NormalizedCredentialResult>;

  validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult>;

  validateContent(content: NormalizedPublishContent): Promise<ContentValidationResult>;

  uploadAsset?(asset: AssetUploadInput, credential: StoredCredential): Promise<AssetUploadResult>;

  publish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult>;

  getPublicationStatus?(externalId: string, credential: StoredCredential): Promise<PublicationStatusResult>;

  deletePublication?(externalId: string, credential: StoredCredential): Promise<DeleteResult>;

  getAnalytics?(externalId: string, credential: StoredCredential): Promise<DistributionMetricsResult>;
}
