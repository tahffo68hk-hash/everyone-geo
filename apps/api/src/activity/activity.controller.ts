import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ActivityService } from "./activity.service";
import { ActivityQueryDto } from "./dto/activity-query.dto";

/**
 * R2 · 统一任务中心（Activity Center）
 *
 * GET /activity
 *   聚合当前用户可见的所有近期任务（纯监测 / Benchmark / 手动测量 / 实验 / 复测）。
 *   支持 project / type / status / q（关键词）/ 分页 筛选；bounded merge + 确定性排序。
 */
@Controller("activity")
@UseGuards(AuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(@CurrentUser() u: JwtUserPayload, @Query() query: ActivityQueryDto) {
    return this.activity.list(u.sub, {
      projectId: query.projectId,
      type: query.type,
      status: query.status,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}
