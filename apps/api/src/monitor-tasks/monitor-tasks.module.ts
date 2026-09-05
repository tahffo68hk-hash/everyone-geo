import { Module } from '@nestjs/common';
import { MonitorTasksController } from './monitor-tasks.controller';
import { MonitorTasksService } from './monitor-tasks.service';
@Module({ controllers: [MonitorTasksController], providers: [MonitorTasksService] })
export class MonitorTasksModule {}
