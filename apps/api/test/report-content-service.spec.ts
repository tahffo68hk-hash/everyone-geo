import { NotFoundException } from "@nestjs/common";
import { ReportContentService } from "../src/quick-start/report-content.service";

describe("ReportContentService tenant access", () => {
  it("checks project membership before returning a report", async () => {
    const prisma = {
      client: {
        geoReport: {
          findUnique: jest.fn().mockResolvedValue({
            id: "report-1",
            projectId: "project-1",
          }),
        },
      },
    };
    const tenant = {
      assertUserInProject: jest
        .fn()
        .mockRejectedValue(new NotFoundException("项目不存在或无权访问")),
    };
    const service = new ReportContentService(prisma as never, tenant as never, {} as never);

    await expect(service.getReport("report-1", "foreign-user")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tenant.assertUserInProject).toHaveBeenCalledWith("foreign-user", "project-1");
  });
});
