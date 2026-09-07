import { Module } from "@nestjs/common";
import { QueryWorkspaceController } from "./query-workspace.controller";
import { QueryWorkspaceService } from "./query-workspace.service";

@Module({
  controllers: [QueryWorkspaceController],
  providers: [QueryWorkspaceService],
  exports: [QueryWorkspaceService],
})
export class QueryWorkspaceModule {}
