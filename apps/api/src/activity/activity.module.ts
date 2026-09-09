import { Module } from "@nestjs/common";
import { ActivityController } from "./activity.controller";
import { ActivityService } from "./activity.service";

/** R2 统一任务中心：PrismaModule 为全局模块，ActivityService 直接可用。 */
@Module({
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
