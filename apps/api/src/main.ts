import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
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

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`GeoLens API listening on http://localhost:${port}`);
}
void bootstrap();
