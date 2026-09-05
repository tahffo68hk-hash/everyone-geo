import { Prisma, type PrismaClient } from '@geo/database';
import { analyzeResponse, ANALYSIS_VERSION, type Entity } from '@geo/core';
import type { ClaimedRun } from '@geo/queue';

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

export function evidenceData(run: ClaimedRun, rawResponse: string, entities: Entity[], durationMs: number) {
  const config = run.engine.config as Record<string, unknown>;
  const structuredCitations = Array.isArray(config.citations) ? config.citations : [];
  return {
    runId: run.id, queryText: run.query.text, rawPrompt: run.query.text, rawResponse,
    provider: 'mock', engineKey: run.engine.key, engineName: run.engine.name,
    model: 'geolens-mock', modelVersion: '1', sourceType: 'mock' as const, retrievalMode: 'unknown' as const,
    metadata: JSON.parse(JSON.stringify({ durationMs, structuredCitations })) as Prisma.InputJsonValue,
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
