import { NotFoundException } from "@nestjs/common";
import { QuickStartService } from "../src/quick-start/quick-start.service";

describe("QuickStartService tenant access", () => {
  it("checks project membership before returning a saved session", async () => {
    const prisma = {
      client: {
        quickStartSession: {
          findUnique: jest.fn().mockResolvedValue({
            id: "session-1",
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
    const service = new QuickStartService(
      prisma as never,
      tenant as never,
      {} as never,
    );

    await expect(service.getSession("session-1", "user-from-another-org")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tenant.assertUserInProject).toHaveBeenCalledWith(
      "user-from-another-org",
      "project-1",
    );
  });

  it("does not disclose a session that does not exist", async () => {
    const prisma = {
      client: {
        quickStartSession: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      },
    };
    const tenant = { assertUserInProject: jest.fn() };
    const service = new QuickStartService(
      prisma as never,
      tenant as never,
      {} as never,
    );

    await expect(service.getSession("missing", "user-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tenant.assertUserInProject).not.toHaveBeenCalled();
  });

  it("does not create a real monitoring run before explicit fee confirmation", async () => {
    const session = {
      id: "session-1",
      projectId: "project-1",
      brandId: "brand-1",
      provider: "DEEPSEEK",
      model: "deepseek-chat",
      questions: Array.from({ length: 8 }, (_, index) => ({
        queryId: `query-${index + 1}`,
        text: `问题 ${index + 1}`,
        kind: index < 6 ? "DISCOVERY" : "BRANDED",
        intent: "信息核实",
      })),
      project: { id: "project-1", industry: "SaaS", competitors: [] },
      brand: { id: "brand-1", name: "Acme", aliases: [] },
    };
    const prisma = {
      client: {
        quickStartSession: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ id: "session-1", projectId: "project-1" })
            .mockResolvedValueOnce(session),
        },
        monitoringRun: { create: jest.fn() },
      },
    };
    const tenant = { assertUserInProject: jest.fn().mockResolvedValue({}) };
    const gateway = { providerStatus: jest.fn() };
    const service = new QuickStartService(prisma as never, tenant as never, gateway as never);

    await expect(service.startRun("session-1", "member-1", { confirmed: false })).rejects.toThrow(
      "确认本次 8 次真实模型请求后才能继续",
    );
    expect(prisma.client.monitoringRun.create).not.toHaveBeenCalled();
    expect(gateway.providerStatus).not.toHaveBeenCalled();
  });

  it("prevents a second monitoring run while the session already has one running", async () => {
    const questions = Array.from({ length: 8 }, (_, index) => ({
      queryId: `query-${index}`,
      text: `问题 ${index + 1}`,
      kind: index < 6 ? "DISCOVERY" : "BRANDED",
      intent: "信息发现",
    }));
    const session = {
      id: "session-1",
      projectId: "project-1",
      brandId: "brand-1",
      provider: "MOCK",
      model: "geolens-mock-v1",
      questions,
      project: { id: "project-1", industry: "SaaS", competitors: [] },
      brand: { id: "brand-1", name: "Acme", aliases: [] },
    };
    const prisma = {
      client: {
        quickStartSession: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ id: "session-1", projectId: "project-1" })
            .mockResolvedValueOnce(session),
        },
        monitoringRun: {
          findFirst: jest.fn().mockResolvedValue({ id: "active-run" }),
          create: jest.fn(),
        },
      },
    };
    const tenant = { assertUserInProject: jest.fn().mockResolvedValue({}) };
    const gateway = {
      providerStatus: jest.fn().mockReturnValue([{ provider: "MOCK", configured: true }]),
    };
    const service = new QuickStartService(prisma as never, tenant as never, gateway as never);

    await expect(service.startRun("session-1", "member-1", { confirmed: false })).rejects.toThrow(
      "当前会话已有检测正在进行",
    );
    expect(prisma.client.monitoringRun.create).not.toHaveBeenCalled();
  });

  it("turns an abandoned run into a partial report from saved evidence", async () => {
    const oldDate = new Date(Date.now() - 180_000);
    const runningRun = {
      id: "run-1",
      sessionId: "session-1",
      projectId: "project-1",
      brandId: "brand-1",
      isMock: true,
      status: "RUNNING",
      startedAt: oldDate,
      responses: [{
        kind: "DISCOVERY",
        brandMentioned: true,
        competitorMentions: ["Other"],
        isMock: true,
        createdAt: oldDate,
      }],
      report: null,
    };
    const recoveredRun = { ...runningRun, status: "PARTIAL", responseCount: 1, report: { id: "report-1" } };
    const client = {
      monitoringRun: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: "run-1", projectId: "project-1" })
          .mockResolvedValueOnce(runningRun)
          .mockResolvedValueOnce(recoveredRun),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      geoReport: { upsert: jest.fn().mockResolvedValue({ id: "report-1" }) },
      quickStartSession: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    client.$transaction.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(client),
    );
    const tenant = { assertUserInProject: jest.fn().mockResolvedValue({}) };
    const service = new QuickStartService({ client } as never, tenant as never, {} as never);

    const result = await service.getRun("run-1", "member-1");
    expect(result?.status).toBe("PARTIAL");
    expect(client.geoReport.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        containsMockData: true,
        metrics: expect.objectContaining({
          total: 1,
          mentioned: 1,
          sampleNote: "检测进程中断；仅统计已保存的回答样本。",
        }),
      }),
    }));
  });
});
