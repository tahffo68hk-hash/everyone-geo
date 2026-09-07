import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { PilotReviewsService } from "./pilot-reviews.service";

@Controller()
@UseGuards(AuthGuard)
export class PilotReviewsController {
  constructor(private readonly reviews: PilotReviewsService) {}

  @Post("experiments/:id/pilot-review")
  @HttpCode(201)
  create(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.reviews.createForExperiment(u.sub, id);
  }

  @Get("experiments/:id/pilot-reviews")
  list(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.reviews.listByExperiment(u.sub, id);
  }

  @Get("pilot-reviews/:id")
  get(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.reviews.getReview(u.sub, id);
  }
}
