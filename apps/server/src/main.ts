import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const prefix = process.env.API_PREFIX ?? '/api';
  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // 接口文档：http://localhost:3100/api/docs —— 交付时直接给买家看
  const config = new DocumentBuilder()
    .setTitle('校园 AI 商城 API')
    .setDescription('零食 + 二手书，AI 助手为核心')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(prefix + '/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  new Logger('Bootstrap').log('API 已启动: http://localhost:' + port + prefix + '  (文档 ' + prefix + '/docs)');
}

void bootstrap();
