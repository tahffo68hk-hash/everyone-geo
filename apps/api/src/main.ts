import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import * as path from "path";
import * as dotenv from "dotenv";
import { AppModule } from "./app.module";

// 显式加载仓库根 .env（见 config/env.ts），确保本地 dev/test 环境一致。
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  app.use(cookieParser());

  const webOrigins =
    (process.env.WEB_ORIGIN ?? "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  app.enableCors({ origin: webOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Swagger（仅开发/测试环境暴露；生产环境 API_PORT 由部署方控制不在此开启 UI）。
  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("GeoLens API")
      .setDescription("AI Visibility Intelligence - GEO 监测数据平台（含 M6A Benchmark API）")
      .setVersion("0.1.0")
      .addTag("benchmark", "M6A GEO Benchmark（版本化 Suite / Run / Metrics）")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`GeoLens API listening on http://localhost:${port}`);
}
void bootstrap();
