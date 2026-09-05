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
          provider: true, engineKey: true, engineName: true, model: true, modelVersion: true,
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
        evidence: { select: { analyses: {
          where: { analysisVersion },
          include: { mentions: true, citations: true },
        } } },
      } } },
    });
    if (!task) throw new NotFoundException('任务不存在或无权访问');
    return aggregateMetrics({
      analysisVersion,
      runs: task.runs.map(run => {
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
  }
}
