import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { Roles, RolesGuard } from '../../common/guards/roles.guard.js';
import { LlmConfigService, type LlmRuntimeConfig } from '../ai/llm-config.service.js';
import { LlmService } from '../ai/llm.service.js';

/**
 * 管理端「AI 设置」。
 *
 * 给不懂技术的卖家用的：在后台填 Base URL / API Key / 模型名，点「测试连接」验证，
 * 保存后立即生效（不需要改 .env、不需要重启服务）。
 * API Key 只在保存时接收，读取时永远只回显前后各 4 位。
 */
@ApiTags('管理端-AI设置')
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminSettingsController {
  constructor(
    private readonly config: LlmConfigService,
    private readonly llm: LlmService,
  ) {}

  @Get('llm')
  @ApiOperation({ summary: '读取当前大模型配置（Key 脱敏）' })
  read() {
    return { ...this.config.describe(), runtime: this.llm.status() };
  }

  @Put('llm')
  @ApiOperation({ summary: '保存大模型配置，立即生效' })
  async save(@Body() body: Partial<LlmRuntimeConfig> & { apiKey?: string }) {
    const patch: Partial<LlmRuntimeConfig> = {};
    if (body.baseUrl !== undefined) patch.baseUrl = String(body.baseUrl).trim().slice(0, 300);
    if (body.model !== undefined) patch.model = String(body.model).trim().slice(0, 100);
    if (body.visionModel !== undefined) patch.visionModel = String(body.visionModel).trim().slice(0, 100);
    if (body.embeddingModel !== undefined) patch.embeddingModel = String(body.embeddingModel).trim().slice(0, 100);
    if (body.timeoutMs !== undefined) {
      const timeout = Number(body.timeoutMs);
      if (Number.isFinite(timeout) && timeout >= 1000) patch.timeoutMs = Math.trunc(timeout);
    }
    // Key 单独处理：留空表示「不修改」，填 "-" 或 "clear" 表示清空
    if (body.apiKey !== undefined) {
      const key = String(body.apiKey).trim();
      if (key === 'clear') patch.apiKey = '';
      else if (key) patch.apiKey = key.slice(0, 300);
    }
    if (patch.baseUrl !== undefined && !/^https?:\/\//.test(patch.baseUrl)) {
      patch.baseUrl = 'https://' + patch.baseUrl.replace(/^\/+/, '');
    }

    await this.config.save(patch);
    return { ...this.config.describe(), runtime: this.llm.status() };
  }

  @Post('llm/test')
  @ApiOperation({ summary: '测试连接：用当前（或页面上填的）配置发一个最小请求' })
  test(@Body() body: { apiKey?: string; baseUrl?: string; model?: string }) {
    const override: Partial<LlmRuntimeConfig> = {};
    if (body.baseUrl) override.baseUrl = String(body.baseUrl).trim();
    if (body.model) override.model = String(body.model).trim();
    // 页面上填了新 Key 就用新的测；没填就用已保存的
    if (body.apiKey && body.apiKey !== 'clear') override.apiKey = String(body.apiKey).trim();
    return this.llm.testConnection(override);
  }

  @Post('llm/reset')
  @ApiOperation({ summary: '恢复默认：清除后台保存的配置，回到 .env' })
  async reset() {
    await this.config.reset();
    return { ...this.config.describe(), runtime: this.llm.status() };
  }
}
