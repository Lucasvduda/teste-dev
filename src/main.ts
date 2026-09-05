import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppLogger } from './common/logger/app-logger.service';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: new AppLogger() });

  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = app.get(ConfigService);
  const port = Number(config.get('PORT', 3000));

  await app.listen(port);
  new Logger('Bootstrap').log(`CEP API rodando em http://localhost:${port} (GET /cep/:cep, GET /health)`);
}

bootstrap();
