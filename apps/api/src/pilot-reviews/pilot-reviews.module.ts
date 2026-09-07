import { Module } from "@nestjs/common";
import { PilotReviewsController } from "./pilot-reviews.controller";
import { PilotReviewsService } from "./pilot-reviews.service";

@Module({
  controllers: [PilotReviewsController],
  providers: [PilotReviewsService],
  exports: [PilotReviewsService],
})
export class PilotReviewsModule {}
