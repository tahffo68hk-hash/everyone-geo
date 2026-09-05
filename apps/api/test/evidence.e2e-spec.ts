// Must precede Prisma/application imports: refuses databases other than geo_test.
import '../../../packages/database/scripts/test-env.cjs';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@geo/database';
import { AppModule } from '../src/app.module';

describe('Evidence and metrics (M4 e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const ids = { users: [] as string[], orgs: [] as string[], projects: [] as string[], tasks: [] as string[], engines: [] as string[], runs: [] as string[] };
  const suffix = randomUUID();
  const rawPrompt = '  原始问题\r\n保持空白 😀  ';
  const rawResponse = '  推荐 GeoLens 😀\r\nOther\nhttps://example.com/a  ';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();
    owner = request.agent(http);
    outsider = request.agent(http);
    for (const [index, agent] of [owner, outsider].entries()) {
      const response = await agent.post('/auth/register').send({ email: `evidence-${index}-${suffix}@m4e2e.test.com`, name: 'Evidence User', password: 'm4-evidence-pass-123' }).expect(201);
      ids.users.push(response.body.user.id);
      ids.orgs.push(response.body.organization.id);
      const project = await prisma.project.create({ data: { organizationId: response.body.organization.id, name: `Evidence ${index} ${suffix}` } });
      ids.projects.push(project.id);
    }
    const engine = await prisma.engine.create({ data: { key: `m4-${suffix}`, name: 'Evidence mock', provider: 'mock' } });
    ids.engines.push(engine.id);
    const task = await prisma.monitorTask.create({ data: { organizationId: ids.orgs[0], projectId: ids.projects[0], totalRuns: 5, status: 'PARTIAL' } });
    ids.tasks.push(task.id);
    const statuses = ['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED', 'FAILED', 'PENDING'] as const;
    for (const [index, status] of statuses.entries()) {
      const query = await prisma.query.create({ data: { projectId: ids.projects[0], text: `Current query ${index}` } });
      const run = await prisma.run.create({ data: { monitorTaskId: task.id, queryId: query.id, engineId: engine.id, status, analysisStatus: index < 2 ? 'SUCCEEDED' : 'PENDING', executionToken: randomUUID() } });
      ids.runs.push(run.id);
      if (index === 4) continue;
      const evidence = await prisma.evidence.create({ data: {
        runId: run.id, queryText: 'Original query snapshot', rawPrompt, rawResponse,
        provider: 'mock', engineKey: 'original-engine', engineName: 'Original engine',
        model: 'mock-model', modelVersion: 'v1', retrievalMode: 'unknown', sourceType: 'mock',
        metadata: { fixture: true }, entitySnapshot: { privateFixture: true },
      } });
      if (index === 2) continue;
      const mentioned = index !== 1;
      await prisma.analysis.create({ data: {
        evidenceId: evidence.id, analysisVersion: 'm4-rule-v1', brandMentioned: mentioned,
        mentionPosition: mentioned ? 1 : null, recommended: mentioned, sentiment: mentioned ? 'positive' : 'unknown',
        mentions: mentioned ? { create: [
          { entityType: 'competitor', entityId: 'other', canonicalName: 'Other', displayName: 'Other', position: 2, context: 'Other', sentiment: 'neutral', startOffset: 18, endOffset: 23 },
          { entityType: 'brand', entityId: 'brand', canonicalName: 'GeoLens', displayName: 'GeoLens', position: 1, context: rawResponse, sentiment: 'positive', startOffset: 5, endOffset: 12 },
        ] } : undefined,
        citations: mentioned ? { create: [
          { url: 'https://example.com/b', domain: 'example.com', title: null, position: 2 },
          { url: 'https://example.com/a', domain: 'example.com', title: 'A', position: 1 },
        ] } : undefined,
      } });
      if (index === 0) await prisma.analysis.create({ data: { evidenceId: evidence.id, analysisVersion: 'm4-rule-legacy', brandMentioned: false, mentionPosition: null, recommended: false, sentiment: 'unknown' } });
    }
  });

  afterAll(async () => {
    try {
      await prisma.monitorTask.deleteMany({ where: { id: { in: ids.tasks } } });
      await prisma.engine.deleteMany({ where: { id: { in: ids.engines } } });
      await prisma.project.deleteMany({ where: { id: { in: ids.projects } } });
      await prisma.organization.deleteMany({ where: { id: { in: ids.orgs } } });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    } finally {
      await app?.close();
      await prisma.$disconnect();
    }
  });

  it('requires authentication on both read endpoints', async () => {
    await request(http).get(`/runs/${ids.runs[0]}`).expect(401);
    await request(http).get(`/monitor-tasks/${ids.tasks[0]}/metrics`).expect(401);
  });

  it('preserves raw evidence snapshots and returns ordered saved analyses without execution internals', async () => {
    const { body } = await owner.get(`/runs/${ids.runs[0]}`).expect(200);
    expect(body).toMatchObject({ id: ids.runs[0], status: 'SUCCEEDED', attempt: 0, analysisStatus: 'SUCCEEDED', analysisErrorCode: null, query: { text: 'Current query 0' }, engine: { id: ids.engines[0] } });
    expect(body.evidence).toMatchObject({ runId: ids.runs[0], queryText: 'Original query snapshot', rawPrompt, rawResponse, engineKey: 'original-engine', engineName: 'Original engine', modelVersion: 'v1', sourceType: 'mock', retrievalMode: 'unknown', metadata: { fixture: true } });
    expect(body.executionToken).toBeUndefined();
    expect(body.evidence.entitySnapshot).toBeUndefined();
    expect(body.evidence.analyses).toHaveLength(2);
    const analysis = body.evidence.analyses.find((item: { analysisVersion: string }) => item.analysisVersion === 'm4-rule-v1');
    expect(analysis.mentions.map((item: { position: number }) => item.position)).toEqual([1, 2]);
    expect(analysis.citations.map((item: { url: string }) => item.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(analysis.mentions[0]).toMatchObject({ canonicalName: 'GeoLens', context: rawResponse, startOffset: 5, endOffset: 12 });
  });

  it('returns null evidence before a response exists', async () => {
    const { body } = await owner.get(`/runs/${ids.runs[4]}`).expect(200);
    expect(body.status).toBe('PENDING');
    expect(body.evidence).toBeNull();
  });

  it('uses analyzed successful runs as denominator, excluding failed providers and missing analyses', async () => {
    const { body } = await owner.get(`/monitor-tasks/${ids.tasks[0]}/metrics`).expect(200);
    expect(body).toEqual({ metricVersion: 'geolens-v1', analysisVersion: 'm4-rule-v1', totalRuns: 5, successfulRuns: 3, failedRuns: 1, cancelledRuns: 0, analyzedRuns: 2, analysisMissingRuns: 1, visibilityRate: 0.5, recommendationRate: 0.5, averageMentionPosition: 1, shareOfVoice: 0.5, citationCount: 2, citationDomainCount: 1, sentimentDistribution: { positive: 1, neutral: 0, negative: 0, unknown: 1 }, metricSource: 'demo' });
  });

  it('isolates saved analysis versions and preserves null rates without eligible analyses', async () => {
    const legacy = await owner.get(`/monitor-tasks/${ids.tasks[0]}/metrics`).query({ analysisVersion: 'm4-rule-legacy' }).expect(200);
    expect(legacy.body).toMatchObject({ analysisVersion: 'm4-rule-legacy', analyzedRuns: 1, analysisMissingRuns: 2, visibilityRate: 0, recommendationRate: 0, averageMentionPosition: null, shareOfVoice: null, citationCount: 0 });
    const absent = await owner.get(`/monitor-tasks/${ids.tasks[0]}/metrics`).query({ analysisVersion: 'not-saved' }).expect(200);
    expect(absent.body).toMatchObject({ analyzedRuns: 0, analysisMissingRuns: 3, visibilityRate: null, recommendationRate: null, shareOfVoice: null });
  });

  it('conceals cross-tenant resources with the same response as nonexistent IDs', async () => {
    for (const [existing, missing] of [
      [`/runs/${ids.runs[0]}`, `/runs/${randomUUID()}`],
      [`/monitor-tasks/${ids.tasks[0]}/metrics`, `/monitor-tasks/${randomUUID()}/metrics`],
    ]) {
      const forbidden = await outsider.get(existing).expect(404);
      const nonexistent = await outsider.get(missing).expect(404);
      expect(forbidden.body).toEqual(nonexistent.body);
    }
  });

  it('rejects invalid UUIDs and unsafe or oversized analysis versions', async () => {
    await owner.get('/runs/invalid').expect(400);
    await owner.get('/monitor-tasks/invalid/metrics').expect(400);
    for (const version of ['', '../version', 'a'.repeat(65)]) {
      await owner.get(`/monitor-tasks/${ids.tasks[0]}/metrics`).query({ analysisVersion: version }).expect(400);
    }
    await owner.get(`/monitor-tasks/${ids.tasks[0]}/metrics?analysisVersion=a&analysisVersion=b`).expect(400);
  });
});
