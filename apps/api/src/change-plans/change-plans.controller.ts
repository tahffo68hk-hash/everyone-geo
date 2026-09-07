import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ChangePlansService } from "./change-plans.service";
import { ChangeItemStatusDto, ChangePlanStatusDto, CreateChangePlanDto } from "./dto/change-plan.dto";

@Controller()
@UseGuards(AuthGuard)
export class ChangePlansController {
  constructor(private readonly plans: ChangePlansService) {}

  @Post("content-opportunities/:id/change-plans")
  @HttpCode(201)
  create(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateChangePlanDto) {
    return this.plans.createFromOpportunity(u.sub, id, { siteAssetId: dto.siteAssetId ?? null });
  }

  @Get("content-opportunities/:id/change-plans")
  list(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.plans.listByOpportunity(u.sub, id);
  }

  @Get("change-plans/:id")
  get(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.plans.getPlan(u.sub, id);
  }

  @Patch("change-plans/:id/status")
  status(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ChangePlanStatusDto) {
    return this.plans.updateStatus(u.sub, id, dto.status);
  }

  @Patch("change-plans/:changePlanId/items/:itemId/status")
  itemStatus(@CurrentUser() u: JwtUserPayload, @Param("changePlanId", ParseUUIDPipe) changePlanId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string, @Body() dto: ChangeItemStatusDto) {
    return this.plans.updateItemStatus(u.sub, changePlanId, itemId, dto.status);
  }
}
