import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CepModule } from './cep/cep.module';
import { HealthController } from './health/health.controller';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CepModule, WebhookModule],
  controllers: [HealthController],
})
export class AppModule {}
