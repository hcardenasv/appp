import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // dev: process.cwd() = app/  → app/public
  // Docker: WORKDIR=/app      → /app/public (copiado por Dockerfile)
  app.useStaticAssets(join(process.cwd(), 'public'));
  const port = process.env.PORT ?? '3000';
  await app.listen(port);
  console.log(`[app] listening on port ${port}`);
}
bootstrap().catch(console.error);
