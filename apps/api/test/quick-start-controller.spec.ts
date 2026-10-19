import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthGuard } from "../src/common/auth.guard";
import { QuickStartController } from "../src/quick-start/quick-start.controller";
import { QuickStartService } from "../src/quick-start/quick-start.service";

describe("QuickStartController", () => {
  let app: INestApplication;
  const service = {
    providers: jest.fn().mockReturnValue([{ provider: "MOCK", configured: true }]),
    createSession: jest.fn(),
    updateQuestions: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QuickStartController],
      providers: [{ provide: QuickStartService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<{
            headers: Record<string, string | undefined>;
            user?: { sub: string; email: string };
          }>();
          if (req.headers["x-test-user"] !== "member-1") {
            throw new UnauthorizedException("未登录");
          }
          req.user = { sub: "member-1", email: "member@example.test" };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("requires an authenticated user on the module API", async () => {
    await request(app.getHttpServer()).get("/quick-start/providers").expect(401);
    expect(service.providers).not.toHaveBeenCalled();
  });

  it("returns providers to an authenticated user", async () => {
    const response = await request(app.getHttpServer())
      .get("/quick-start/providers")
      .set("x-test-user", "member-1")
      .expect(200);
    expect(response.body).toEqual([{ provider: "MOCK", configured: true }]);
    expect(service.providers).toHaveBeenCalledTimes(1);
  });

  it("validates a session request before calling business logic", async () => {
    await request(app.getHttpServer())
      .post("/quick-start/sessions")
      .set("x-test-user", "member-1")
      .send({ organizationId: "not-a-uuid", brandName: "Acme" })
      .expect(400);
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it("requires between 8 and 12 questions before saving a monitoring set", async () => {
    await request(app.getHttpServer())
      .patch("/quick-start/sessions/00000000-0000-4000-8000-000000000001/questions")
      .set("x-test-user", "member-1")
      .send({ questions: Array.from({ length: 7 }, (_, index) => ({
        text: `问题 ${index + 1}`,
        kind: "DISCOVERY",
        intent: "信息发现",
      })) })
      .expect(400);
    expect(service.updateQuestions).not.toHaveBeenCalled();
  });

  it("accepts an existing project context when creating a quick-start session", async () => {
    service.createSession.mockResolvedValueOnce({ id: "session-1" });
    await request(app.getHttpServer())
      .post("/quick-start/sessions")
      .set("x-test-user", "member-1")
      .send({
        organizationId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        brandName: "Acme",
      })
      .expect(201);
    expect(service.createSession).toHaveBeenCalledWith("member-1", expect.objectContaining({
      projectId: "00000000-0000-4000-8000-000000000002",
    }));
  });
});
