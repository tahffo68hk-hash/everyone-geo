import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createRunQueue, dispatchPendingRuns } from '@geo/queue';
import { enginePresentation, readRealProviderEnv } from '@geo/llm';
import { PrismaService } from '../prisma.service';
import { TenantService } from '../common/tenant.service';
import { CreateMonitorTaskDto } from './create-monitor-task.dto';

@Injectable()
export class MonitorTasksService implements OnModuleDestroy {
  private queue?: ReturnType<typeof createRunQueue>;
  private dispatching?: Promise<void>;
  constructor(private readonly db: PrismaService, private readonly tenant: TenantService) {}

  /**
   * Engine options expose presentation only (provider / model / configured /
   * sourceType). Secrets never leave the server: `configured` is a boolean and
   * no API key is ever part of the response.
   */
  async options(userId: string) {
    const [projects, engines] = await Promise.all([
      this.db.client.project.findMany({
        where: { organization: { members: { some: { userId } } }, status: 'ACTIVE' },
        select: { id: true, name: true, queries: { where: { status: 'ACTIVE' }, select: { id: true, text: true }, orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.client.engine.findMany({ where: { enabled: true }, orderBy: { key: 'asc' } }),
    ]);
    return {
      projects,
      engines: engines.map(engine => {
        const presentation = enginePresentation(engine.provider, engine.config, process.env);
        return {
          id: engine.id, key: engine.key, name: engine.name,
          provider: presentation.provider, sourceType: presentation.sourceType,
          model: presentation.model, configured: presentation.configured,
        };
      }),
    };
  }

  async create(userId: string, dto: CreateMonitorTaskDto) {
    const started = Date.now();
    const project = await this.tenant.assertUserInProject(userId, dto.projectId);
    const queries = await this.db.client.query.count({ where: { id: { in: dto.queryIds }, projectId: project.id, status: 'ACTIVE' } });
    if (queries !== dto.queryIds.length) {
      throw new BadRequestException('Query 不可用，或 Query 不属于当前项目');
    }
    const engines = await this.db.client.engine.findMany({ where: { id: { in: dto.engineIds } } });
    if (engines.length !== dto.engineIds.length) {
      throw new BadRequestException('Engine 不存在，或已被移除');
    }
    const byId = new Map(engines.map(engine => [engine.id, engine]));
    let realEngineCount = 0;
    for (const engineId of dto.engineIds) {
      const engine = byId.get(engineId)!;
      if (!engine.enabled) throw new BadRequestException(`引擎「${engine.name}」已停用`);
      if (engine.provider === 'mock') continue;
      const presentation = enginePresentation(engine.provider, engine.config, process.env);
      if (engine.provider === 'deepseek') {
        if (!presentation.configured) {
          throw new BadRequestException(`引擎「${engine.name}」不可用：DeepSeek Provider 未配置或未启用（需 ENABLE_REAL_PROVIDERS=true 且配置 DEEPSEEK_API_KEY）。`);
        }
        realEngineCount += 1;
        continue;
      }
      throw new BadRequestException(`引擎「${engine.name}」的 Provider（${engine.provider}）暂不支持`);
    }
    const realRuns = realEngineCount * dto.queryIds.length;
    const cap = readRealProviderEnv(process.env).realProviderMaxRunsPerTask;
    if (realRuns > cap) {
      throw new BadRequestException(`真实 Provider 单任务运行数上限为 ${cap} 次，本次将产生 ${realRuns} 次真实调用。请减少查询或真实引擎数量后重试。`);
    }
    const task = await this.db.client.$transaction(async (tx) => {
      return tx.monitorTask.create({
        data: {
          organizationId: project.organizationId, projectId: project.id,
          totalRuns: dto.queryIds.length * dto.engineIds.length,
          runs: { create: dto.queryIds.flatMap(queryId => dto.engineIds.map(engineId => ({ queryId, engineId }))) },
        },
        include: { runs: true },
      });
    });
    console.log(JSON.stringify({ event: 'monitor_task_created', taskId: task.id, status: task.status, totalRuns: task.totalRuns, duration: Date.now() - started }));
    // Database commit is durable before enqueue. Worker reconciliation repairs
    // process crashes / Redis outages; HTTP never waits for execution or Redis.
    this.kickDispatch();
    return this.present(task);
  }

  async get(userId: string, id: string) {
    const task = await this.db.client.monitorTask.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      include: { runs: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!task) throw new NotFoundException('任务不存在或无权访问');
    return this.present(task);
  }

  private kickDispatch() {
    if (this.dispatching) return;
    if (!this.queue) {
      this.queue = createRunQueue();
      this.queue.on('error', () => console.error(JSON.stringify({ event: 'queue_error', error: 'REDIS_UNAVAILABLE' })));
    }
    this.dispatching = dispatchPendingRuns(this.db.client, this.queue)
      .then(() => undefined)
      .catch(() => console.error(JSON.stringify({ event: 'enqueue_deferred', error: 'REDIS_UNAVAILABLE' })))
      .finally(() => { this.dispatching = undefined; });
  }

  private present(task: {
    id: string; status: string; totalRuns: number; completedRuns: number; failedRuns: number;
    createdAt: Date; startedAt: Date | null; completedAt: Date | null;
    runs: Array<{ id: string; queryId: string; engineId: string; status: string; attempt: number; errorCode: string | null; errorMessage: string | null }>;
  }) {
    const cancelled = task.runs.filter(run => run.status === 'CANCELLED').length;
    return {
      id: task.id, status: task.status, totalRuns: task.totalRuns,
      completedRuns: task.completedRuns, failedRuns: task.failedRuns,
      progress: task.totalRuns ? Math.round(100 * (task.completedRuns + task.failedRuns + cancelled) / task.totalRuns) : 0,
      createdAt: task.createdAt, startedAt: task.startedAt, completedAt: task.completedAt,
      runs: task.runs.map(({ id, queryId, engineId, status, attempt, errorCode, errorMessage }) => ({ id, queryId, engineId, status, attempt, errorCode, errorMessage })),
    };
  }

  async onModuleDestroy() {
    await this.dispatching;
    await this.queue?.close();
  }
}
