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

  it("saves an edited video script while preserving generation and quality metadata", async () => {
    const metadata = {
      promptVersion: "geolens-content-v2-bilibili",
      riskNotes: ["请核实产品资料"],
      videoScript: { narration: "旧讲解稿" },
    };
    const prisma = {
      client: {
        contentAsset: {
          findUnique: jest.fn().mockResolvedValue({
            id: "content-1",
            projectId: "project-1",
            metadata,
          }),
          update: jest.fn().mockResolvedValue({ id: "content-1", metadata }),
        },
      },
    };
    const tenant = { assertUserInProject: jest.fn().mockResolvedValue({}) };
    const service = new ReportContentService(prisma as never, tenant as never, {} as never);

    await service.saveContent("content-1", "member-1", {
      title: "标题",
      summaryText: "编辑后的摘要。",
      body: "简介",
      hashtags: ["#主题"],
      videoScriptText: "已调整的完整讲解稿。",
    });

    expect(prisma.client.contentAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: {
          ...metadata,
          summaryText: "编辑后的摘要。",
          videoScriptText: "已调整的完整讲解稿。",
        },
      }),
    }));
  });
});
