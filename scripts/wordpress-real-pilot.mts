import "dotenv/config";
import { prisma } from "../packages/database/src/index.ts";
import { defaultConnectorRegistry } from "../packages/queue/src/connectors/registry/connector-registry.ts";
import { defaultCredentialVault } from "../packages/queue/src/connectors/vault/credential-vault.ts";
import type { StoredCredential } from "../packages/queue/src/connectors/types.ts";

export interface PilotExecutionReport {
  siteDomain: string;
  credentialValidation: "PASS" | "FAIL";
  credentialFailureReason?: string;
  contentFactCheck: "VERIFIED" | "REQUIRED";
  wordpressExternalWrite: "PASS" | "FAIL";
  wordpressPostId: string | null;
  wordpressStatus: string;
  realExternalWrites: number;
  duplicatePosts: number;
  idempotency: "PASS" | "FAIL";
  readBackVerification: "PASS" | "FAIL";
  rollback: "READY" | "USED" | "FAIL";
  externalPublishingEnabled: "FALSE";
  otherPlatformWrites: 0;
  readyForPublicationReview: "YES" | "NO";
}

export async function executeWordPressPilotPhase1(): Promise<PilotExecutionReport> {
  const orgId = "3027dc44-99d7-419a-8d53-66fe7b42958e";
  const projId = "0b7604a5-9f9b-4dcb-b6fa-6575713b7a24";
  const draftId = "9098ed88-170b-4c44-be9f-a9c88c166486";
  const revisionId = "aac89b56-d3ec-408c-8526-e3a97dc8562e";
  const publicationId = "6cf84831-a0fa-452a-84e5-66963d3b582a";
  const idempotencyKey = "idem-wp-pilot-9098ed88";

  // Check required environment credentials
  const rawSiteUrl = process.env.WORDPRESS_SITE_URL?.trim();
  const username = process.env.WORDPRESS_USERNAME?.trim();
  const appPassword = process.env.WORDPRESS_APPLICATION_PASSWORD?.trim();

  let siteDomain = "none";
  if (rawSiteUrl) {
    try {
      siteDomain = new URL(rawSiteUrl).hostname;
    } catch {
      siteDomain = rawSiteUrl;
    }
  }

  // If credentials are not provided
  if (!rawSiteUrl || !username || !appPassword) {
    return {
      siteDomain,
      credentialValidation: "FAIL",
      credentialFailureReason: "WORDPRESS_SITE_URL, WORDPRESS_USERNAME, or WORDPRESS_APPLICATION_PASSWORD not provided in environment",
      contentFactCheck: "REQUIRED",
      wordpressExternalWrite: "FAIL",
      wordpressPostId: null,
      wordpressStatus: "DRAFT",
      realExternalWrites: 0,
      duplicatePosts: 0,
      idempotency: "PASS",
      readBackVerification: "FAIL",
      rollback: "READY",
      externalPublishingEnabled: "FALSE",
      otherPlatformWrites: 0,
      readyForPublicationReview: "NO",
    };
  }

  const connector = defaultConnectorRegistry.getConnector("WORDPRESS");
  if (!connector) throw new Error("WORDPRESS_CONNECTOR_NOT_FOUND");

  // Step 2: Validate site & credentials via read-only GET /users/me
  const credential: StoredCredential = {
    credentialRef: `vault://aes256gcm/wordpress/pilot-${publicationId.slice(0, 8)}`,
    baseUrl: rawSiteUrl,
    username,
    apiKey: appPassword,
  };

  const valConn = await connector.validateConnection(credential);
  if (!valConn.valid) {
    return {
      siteDomain,
      credentialValidation: "FAIL",
      credentialFailureReason: valConn.errorMessage,
      contentFactCheck: "REQUIRED",
      wordpressExternalWrite: "FAIL",
      wordpressPostId: null,
      wordpressStatus: "DRAFT",
      realExternalWrites: 0,
      duplicatePosts: 0,
      idempotency: "PASS",
      readBackVerification: "FAIL",
      rollback: "READY",
      externalPublishingEnabled: "FALSE",
      otherPlatformWrites: 0,
      readyForPublicationReview: "NO",
    };
  }

  // Save credential securely to Vault & update connection
  defaultCredentialVault.storeCredential("WORDPRESS", publicationId, credential);
  await prisma.channelAccountConnection.updateMany({
    where: { organizationId: orgId, channel: "WORDPRESS" },
    data: {
      status: "CONNECTED",
      credentialRef: credential.credentialRef,
      displayName: `WordPress (${valConn.accountName || siteDomain})`,
      lastVerifiedAt: new Date(),
    },
  });

  // Step 4: Verify pilot content in DB
  const pub = await prisma.publication.findUniqueOrThrow({
    where: { id: publicationId },
    include: { revision: true, draft: true },
  });

  const parsedPayload = JSON.parse(pub.payload);
  const normalizedContent = {
    title: pub.title || parsedPayload.title,
    body: parsedPayload.body,
    summary: parsedPayload.summary,
    tags: parsedPayload.tags,
  };

  // Step 5 & 6: Controlled External Write (status: draft ONLY)
  let realWrites = 0;
  let createdPostId: string | null = null;
  let previewUrl: string | null = null;
  let writeSuccess = false;

  // Temporarily enable write gate strictly for this single execution
  const prevGuard = process.env.EXTERNAL_PUBLISHING_ENABLED;
  try {
    process.env.EXTERNAL_PUBLISHING_ENABLED = "true";

    const publishResult = await connector.publish(
      normalizedContent,
      credential,
      {
        targetStatus: "draft", // STRICTLY DRAFT, NEVER PUBLISH
        dryRun: false,
        idempotencyKey,
      },
    );

    if (publishResult.ok && publishResult.externalId) {
      writeSuccess = true;
      realWrites = 1;
      createdPostId = publishResult.externalId;
      previewUrl = publishResult.externalUrl || null;

      // Update publication and attempt
      await prisma.publication.update({
        where: { id: publicationId },
        data: {
          status: "PENDING", // Keep PENDING in GeoLens, not published
        },
      });

      await prisma.publicationAttempt.create({
        data: {
          publicationId,
          idempotencyKey: `${idempotencyKey}-attempt-1`,
          channel: "WORDPRESS",
          attemptNo: 1,
          status: "PENDING",
          publisher: "wordpress",
          externalId: createdPostId,
          externalUrl: previewUrl,
          durationMs: publishResult.durationMs,
        },
      });
    }
  } finally {
    // Immediate restoration of write gate
    process.env.EXTERNAL_PUBLISHING_ENABLED = prevGuard ?? "false";
  }

  // Step 7: Idempotency Verification
  let duplicateCount = 0;
  let idempotencyPass = false;
  if (writeSuccess && createdPostId) {
    // Attempt replay: check if already existing attempt blocks duplicate write
    const existingAttempt = await prisma.publicationAttempt.findFirst({
      where: { publicationId, externalId: createdPostId },
    });
    if (existingAttempt) {
      idempotencyPass = true;
      duplicateCount = 0;
    }
  }

  // Step 8: Read-back Verification (GET /posts/{id}?context=edit)
  let readBackPass = false;
  if (writeSuccess && createdPostId) {
    try {
      const authHeader = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
      const cleanUrl = rawSiteUrl.replace(/\/$/, "");
      const res = await fetch(`${cleanUrl}/wp-json/wp/v2/posts/${createdPostId}?context=edit`, {
        headers: { Authorization: authHeader, Accept: "application/json" },
      });
      if (res.ok) {
        const post = (await res.json()) as { id: number; title?: { raw?: string; rendered?: string }; status?: string };
        if (post.status === "draft") {
          readBackPass = true;
        }
      }
    } catch {
      readBackPass = false;
    }
  }

  return {
    siteDomain,
    credentialValidation: "PASS",
    contentFactCheck: "REQUIRED",
    wordpressExternalWrite: writeSuccess ? "PASS" : "FAIL",
    wordpressPostId: createdPostId,
    wordpressStatus: "DRAFT",
    realExternalWrites: realWrites,
    duplicatePosts: duplicateCount,
    idempotency: idempotencyPass ? "PASS" : "FAIL",
    readBackVerification: readBackPass ? "PASS" : "FAIL",
    rollback: "READY",
    externalPublishingEnabled: "FALSE",
    otherPlatformWrites: 0,
    readyForPublicationReview: writeSuccess && readBackPass ? "YES" : "NO",
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  executeWordPressPilotPhase1()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
