import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(__dirname, '..', 'public'));
  const port = process.env.PORT ?? '3000';
  await app.listen(port);
  console.log(`[app] listening on port ${port}`);
}
bootstrap().catch(console.error);
