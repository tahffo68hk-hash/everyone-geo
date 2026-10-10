import { Controller, Get, Param } from "@nestjs/common";
import { ReportsService } from "./reports.service";

/**
 * Public H5 Benchmark Report API.
 * Unauthenticated read-only endpoint accessed via cryptographically secure shareToken.
 * Private reports cannot be queried without valid, active shareToken.
 */
@Controller("public/reports")
export class PublicReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(":token")
  getPublicReport(@Param("token") token: string) {
    return this.reports.getPublicReport(token);
  }
}
