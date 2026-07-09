import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { setupApp } from './setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  setupApp(app);
  app.enableShutdownHooks();
  await app.init();
  // HOMI-17: the gateway shares the HTTP server, hooking WebSocket
  // upgrades on /v1/houses/:id/realtime
  app.get(RealtimeGateway).attach(app.getHttpServer());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`HOMI API listening on :${port}`);
}

void bootstrap();
