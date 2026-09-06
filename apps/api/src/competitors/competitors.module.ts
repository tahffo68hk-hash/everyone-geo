import { Module } from "@nestjs/common";
import { CompetitorsController } from "./competitors.controller";
import { CompetitorsService } from "./competitors.service";

@Module({ controllers: [CompetitorsController], providers: [CompetitorsService] })
export class CompetitorsModule {}
