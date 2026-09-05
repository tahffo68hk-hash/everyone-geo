import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, JwtUserPayload } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateMonitorTaskDto } from './create-monitor-task.dto';
import { MonitorTasksService } from './monitor-tasks.service';

@Controller('monitor-tasks')
@UseGuards(AuthGuard)
export class MonitorTasksController {
  constructor(private readonly tasks: MonitorTasksService) {}
  @Get('options') options(@CurrentUser() user: JwtUserPayload) { return this.tasks.options(user.sub); }
  @Post() @HttpCode(202)
  create(@CurrentUser() user: JwtUserPayload, @Body() body: CreateMonitorTaskDto) { return this.tasks.create(user.sub, body); }
  @Get(':id')
  get(@CurrentUser() user: JwtUserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.tasks.get(user.sub, id); }
}
