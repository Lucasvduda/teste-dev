import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CepModule } from './cep/cep.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CepModule],
  controllers: [HealthController],
})
export class AppModule {}
