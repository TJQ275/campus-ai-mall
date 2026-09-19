import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { assertProductionSecrets } from './config/configuration.js';

/** 已知的占位密钥：生产环境里出现任何一个都直接拒绝启动 */
const PLACEHOLDER_SECRETS = ['', 'change-me-in-production-please', 'dev-secret-change-me', 'secret', 'changeme'];

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isProduction = process.env.NODE_ENV === 'production';

  // 生产环境必须换成真密钥，否则任何人都能伪造 token —— 宁可起不来也不要带着漏洞上线
  assertProductionSecrets(isProduction, PLACEHOLDER_SECRETS, logger);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // CORS：默认放开（本地联调方便）。生产环境请用 CORS_ORIGINS 指定白名单，
    // 例如 CORS_ORIGINS=https://admin.example.com,https://h5.example.com
    cors: buildCorsOptions(isProduction, logger),
  });

  // 上传的商品图 / 用户评价图：静态托管在 /uploads
  app.useStaticAssets(path.resolve(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // 上传接口收 base64 图片，默认的 100kb JSON 限制会让稍大的图片直接 413。
  // 放宽到 8mb（5MB 图片 base64 后约 6.7MB），真正的业务校验在 UploadController 里。
  app.useBodyParser('json', { limit: '8mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  const prefix = process.env.API_PREFIX ?? '/api';
  app.setGlobalPrefix(prefix);
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  // 注意：这里不再注册 class-validator 的 ValidationPipe。
  // 它的校验依赖 DTO 类和装饰器，而本项目的入参都是 TS 接口（运行时被擦除），
  // 注册了也只是个空壳。入参校验统一走 shared 包里的 Zod schema + ZodValidationPipe。

  // 接口文档：http://localhost:3100/api/docs —— 交付时直接给买家看。
  // 生产环境默认关闭（会暴露全部接口结构），需要时用 SWAGGER_ENABLED=true 打开。
  const swaggerEnabled = process.env.SWAGGER_ENABLED ? process.env.SWAGGER_ENABLED === 'true' : !isProduction;
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('AI优选零食 API')
      .setDescription('零食 + 二手书，AI 助手为核心')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(prefix + '/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  logger.log('API 已启动: http://localhost:' + port + prefix + (swaggerEnabled ? '  (文档 ' + prefix + '/docs)' : ''));
  if (!isProduction) {
    logger.log('当前是开发模式：接口文档开放、登录接口限流较宽松。上线前请设置 NODE_ENV=production');
  }
}

function buildCorsOptions(isProduction: boolean, logger: Logger) {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    if (isProduction) {
      logger.warn('未设置 CORS_ORIGINS，生产环境将放行所有来源。建议用 CORS_ORIGINS 指定后台域名白名单');
    }
    return true;
  }
  const allowed = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  logger.log('CORS 白名单: ' + allowed.join(', '));
  return {
    origin: allowed,
    credentials: true,
  };
}

void bootstrap();
