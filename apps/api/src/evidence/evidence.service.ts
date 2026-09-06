import { Injectable, NotFoundException } from '@nestjs/common';
import { aggregateMetrics } from '@geo/core';
import { PrismaService } from '../prisma.service';

@Injectable()
export class EvidenceService {
  constructor(private readonly db: PrismaService) {}

  async getRun(userId: string, id: string) {
    const run = await this.db.client.run.findFirst({
      where: { id, monitorTask: { organization: { members: { some: { userId } } } } },
      select: {
        id: true, status: true, attempt: true, analysisStatus: true, analysisErrorCode: true,
        query: { select: { id: true, text: true } },
        engine: { select: { id: true, key: true, name: true } },
        evidence: { select: {
          id: true, runId: true, queryText: true, rawPrompt: true, rawResponse: true,
          provider: true, engineKey: true, engineName: true,
          requestedModel: true, responseModel: true, // M6C model identity
          model: true, modelVersion: true, // legacy 兼容
          retrievalMode: true, sourceType: true, metadata: true, createdAt: true,
          analyses: {
            orderBy: [{ createdAt: 'asc' }, { analysisVersion: 'asc' }],
            include: {
              mentions: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
              citations: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
            },
          },
        } },
      },
    });
    if (!run) throw new NotFoundException('运行不存在或无权访问');
    return run;
  }

  async getMetrics(userId: string, id: string, analysisVersion = 'm4-rule-v1') {
    const task = await this.db.client.monitorTask.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      select: { runs: { select: {
        status: true,
        engine: { select: { provider: true } },
        evidence: { select: { analyses: {
          where: { analysisVersion },
          include: { mentions: true, citations: true },
        } } },
      } } },
    });
    if (!task) throw new NotFoundException('任务不存在或无权访问');
    // Metrics data integrity (M5): demo (mock) data never pollutes real GEO
    // metrics. When a task contains any real run, the metric pool is the real
    // subset only and metricSource says so ('real' or 'mixed').
    const realRuns = task.runs.filter(run => run.engine.provider !== 'mock');
    const metricSource = realRuns.length === 0 ? 'demo'
      : realRuns.length === task.runs.length ? 'real' : 'mixed';
    const pool = realRuns.length > 0 ? realRuns : task.runs;
    const metrics = aggregateMetrics({
      analysisVersion,
      runs: pool.map(run => {
        const analysis = run.evidence?.analyses[0];
        return {
          status: run.status,
          analysis: analysis ? {
            ...analysis,
            mentions: analysis.mentions.map(mention => ({
              ...mention, entityType: mention.entityType as 'brand' | 'competitor',
            })),
          } : null,
        };
      }),
    });
    return { ...metrics, metricSource };
  }
}
