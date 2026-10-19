import { NotFoundException } from "@nestjs/common";
import { DistributionService } from "../src/quick-start/distribution.service";

describe("DistributionService tenant access", () => {
  it("checks project membership before exposing a distribution task", async () => {
    const prisma = {
      client: {
        distributionTask: {
          findUnique: jest.fn().mockResolvedValue({
            id: "task-1",
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
    const service = new DistributionService(prisma as never, tenant as never);

    await expect(service.getTask("task-1", "foreign-user")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tenant.assertUserInProject).toHaveBeenCalledWith("foreign-user", "project-1");
  });
});
