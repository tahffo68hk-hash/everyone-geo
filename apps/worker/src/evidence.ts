import { Prisma, type PrismaClient } from '@geo/database';
import { analyzeResponse, ANALYSIS_VERSION, type Entity } from '@geo/core';
import type { ClaimedRun } from '@geo/queue';
import type { ProviderResponse } from '@geo/llm';

export async function snapshotEntities(db: PrismaClient, projectId: string): Promise<Entity[]> {
  const [brands, competitors] = await Promise.all([
    db.brand.findMany({ where: { projectId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    db.competitor.findMany({ where: { projectId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ]);
  return [
    ...brands.slice(0, 1).map(row => ({ id: row.id, canonicalName: row.name, aliases: row.aliases, entityType: 'brand' as const })),
    ...competitors.map(row => ({ id: row.id, canonicalName: row.name, aliases: row.aliases, entityType: 'competitor' as const })),
  ];
}

/**
 * Raw Evidence snapshot built from a normalized ProviderResponse.
 * The same immutable Evidence contract applies to every provider: a Run writes
 * exactly one Evidence row and the DB trigger rejects later UPDATEs.
 *
 * sourceType / retrievalMode are capabilities of the provider (mock => mock,
 * deepseek => official_api / api_plain). Secrets never reach this object.
 */
export function evidenceData(run: ClaimedRun, response: ProviderResponse, entities: Entity[]) {
  const metadata: Record<string, unknown> = { durationMs: response.durationMs };
  // Always present so UI can distinguish "structured citation" vs text-extracted URLs.
  metadata.structuredCitations = response.structuredCitations ?? [];
  if (response.usage) metadata.usage = response.usage;
  if (response.requestId) metadata.requestId = response.requestId;
  if (response.finishReason) metadata.finishReason = response.finishReason;
  if (response.rawProviderPayload !== undefined) metadata.rawProviderPayload = response.rawProviderPayload;
  return {
    runId: run.id, queryText: run.query.text, rawPrompt: response.rawPrompt, rawResponse: response.content,
    provider: response.provider, engineKey: run.engine.key, engineName: run.engine.name,
    // M6C model identity：requestedModel / responseModel 为新语义字段；model /
    // modelVersion 为 legacy 兼容（新代码优先读新字段）。
    requestedModel: response.requestedModel, responseModel: response.responseModel,
    model: response.model, modelVersion: response.modelVersion,
    sourceType: response.sourceType, retrievalMode: response.retrievalMode,
    metadata: JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue,
    entitySnapshot: JSON.parse(JSON.stringify(entities)) as Prisma.InputJsonValue,
  };
}

type Analyzer = typeof analyzeResponse;
/** Append a version; never update raw evidence or a saved analysis version. */
export async function analyzeEvidence(db: PrismaClient, evidenceId: string, options: { version?: string; analyzer?: Analyzer } = {}): Promise<boolean> {
  const version = options.version ?? ANALYSIS_VERSION;
  const evidence = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId }, include: { run: { select: { monitorTaskId: true } } } });
  try {
    const existing = await db.analysis.findUnique({ where: { evidenceId_analysisVersion: { evidenceId, analysisVersion: version } } });
    if (existing) return true;
    const entities = evidence.entitySnapshot as unknown as Entity[];
    if (!Array.isArray(entities)) throw new Error('INVALID_ENTITY_SNAPSHOT');
    const meta = evidence.metadata as Record<string, unknown>;
    const citations = Array.isArray(meta.structuredCitations) ? meta.structuredCitations as Array<{ url: string; title?: string }> : [];
    const result = (options.analyzer ?? analyzeResponse)({ rawResponse: evidence.rawResponse, entities, structuredCitations: citations });
    if (result.analysisVersion !== version) throw new Error('ANALYSIS_VERSION_MISMATCH');
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "MonitorTask" WHERE id=${evidence.run.monitorTaskId}::uuid FOR UPDATE`;
      if (await tx.analysis.findUnique({ where: { evidenceId_analysisVersion: { evidenceId, analysisVersion: version } } })) return;
      await tx.analysis.create({ data: {
        evidenceId, analysisVersion: version, brandMentioned: result.brandMentioned,
        mentionPosition: result.mentionPosition, recommended: result.recommended, sentiment: result.sentiment,
        mentions: { create: result.mentions }, citations: { create: result.citations },
      } });
      if (version === ANALYSIS_VERSION) await tx.run.update({ where: { id: evidence.runId }, data: {
        analysisStatus: 'SUCCEEDED', analysisErrorCode: null, analysisAttempts: { increment: 1 },
      } });
    });
    return true;
  } catch {
    if (version === ANALYSIS_VERSION) await db.run.updateMany({ where: { id: evidence.runId, analysisStatus: { not: 'SUCCEEDED' } }, data: {
      analysisStatus: 'FAILED', analysisErrorCode: 'ANALYSIS_FAILED', analysisAttempts: { increment: 1 },
    } });
    return false;
  }
}

/** Repair a crash after provider success; never call the provider again for analysis. */
export async function recoverAnalyses(db: PrismaClient) {
  const rows = await db.run.findMany({
    where: { status: 'SUCCEEDED', analysisStatus: { in: ['PENDING', 'FAILED'] }, analysisAttempts: { lt: 3 }, evidence: { isNot: null } },
    select: { evidence: { select: { id: true } } }, take: 100, orderBy: { createdAt: 'asc' },
  });
  for (const row of rows) if (row.evidence) await analyzeEvidence(db, row.evidence.id);
}
