import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, JwtUserPayload } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { EvidenceService } from './evidence.service';

@Controller()
@UseGuards(AuthGuard)
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get('runs/:id')
  getRun(@CurrentUser() user: JwtUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.evidence.getRun(user.sub, id);
  }

  @Get('monitor-tasks/:id/metrics')
  getMetrics(
    @CurrentUser() user: JwtUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('analysisVersion') analysisVersion?: string,
  ) {
    if (analysisVersion !== undefined &&
      (typeof analysisVersion !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(analysisVersion))) {
      throw new BadRequestException('analysisVersion 必须为 1–64 位字母、数字、点、下划线或连字符');
    }
    return this.evidence.getMetrics(user.sub, id, analysisVersion);
  }
}
