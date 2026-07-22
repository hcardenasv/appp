import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // In dev (nest start --watch) __dirname = dist/src, process.cwd() = app/
  // In prod (node dist/main.js) __dirname = dist, so we try both
  const publicPath = process.env.NODE_ENV === 'production'
    ? join(__dirname, 'public')
    : join(process.cwd(), 'public');
  app.useStaticAssets(publicPath);
  const port = process.env.PORT ?? '3000';
  await app.listen(port);
  console.log(`[app] listening on port ${port}`);
}
bootstrap().catch(console.error);
