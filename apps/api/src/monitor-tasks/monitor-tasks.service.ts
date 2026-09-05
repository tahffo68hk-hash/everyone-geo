import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createRunQueue, dispatchPendingRuns } from '@geo/queue';
import { PrismaService } from '../prisma.service';
import { TenantService } from '../common/tenant.service';
import { CreateMonitorTaskDto } from './create-monitor-task.dto';

@Injectable()
export class MonitorTasksService implements OnModuleDestroy {
  private queue?: ReturnType<typeof createRunQueue>;
  private dispatching?: Promise<void>;
  constructor(private readonly db: PrismaService, private readonly tenant: TenantService) {}

  async options(userId: string) {
    const [projects, engines] = await Promise.all([
      this.db.client.project.findMany({
        where: { organization: { members: { some: { userId } } }, status: 'ACTIVE' },
        select: { id: true, name: true, queries: { where: { status: 'ACTIVE' }, select: { id: true, text: true }, orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.client.engine.findMany({ where: { enabled: true, provider: 'mock' }, select: { id: true, key: true, name: true }, orderBy: { key: 'asc' } }),
    ]);
    return { projects, engines };
  }

  async create(userId: string, dto: CreateMonitorTaskDto) {
    const started = Date.now();
    const project = await this.tenant.assertUserInProject(userId, dto.projectId);
    const task = await this.db.client.$transaction(async (tx) => {
      const queries = await tx.query.count({ where: { id: { in: dto.queryIds }, projectId: project.id, status: 'ACTIVE' } });
      const engines = await tx.engine.count({ where: { id: { in: dto.engineIds }, enabled: true, provider: 'mock' } });
      if (queries !== dto.queryIds.length || engines !== dto.engineIds.length) {
        throw new BadRequestException('Query 或 Mock Engine 不可用，或 Query 不属于当前项目');
      }
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
