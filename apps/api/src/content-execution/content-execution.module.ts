import { Module } from "@nestjs/common";
import { ContentExecutionController } from "./content-execution.controller";
import { ContentExecutionService } from "./content-execution.service";

@Module({
  controllers: [ContentExecutionController],
  providers: [ContentExecutionService],
  exports: [ContentExecutionService],
})
export class ContentExecutionModule {}
