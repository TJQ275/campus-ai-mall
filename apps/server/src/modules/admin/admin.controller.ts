import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAiService } from './admin-ai.service.js';
import { AdminShopService } from './admin-shop.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { Roles, RolesGuard } from '../../common/guards/roles.guard.js';

@ApiTags('管理端-AI')
@Controller('admin/ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAiController {
  constructor(private readonly adminAi: AdminAiService) {}

  @Get('stats')
  @ApiOperation({ summary: 'AI 调用统计：按工具聚合 + 运行模式' })
  stats(@Query('days') days?: string) {
    return this.adminAi.stats(days ? Number(days) : 7);
  }

  @Get('tool-calls')
  @ApiOperation({ summary: 'AI 工具调用日志（可回放每一次调用）' })
  toolCalls(@Query() q: { toolName?: string; status?: string; page?: string; pageSize?: string }) {
    return this.adminAi.toolCalls({
      toolName: q.toolName, status: q.status,
      page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 20,
    });
  }

  @Get('conversations')
  @ApiOperation({ summary: 'AI 会话列表' })
  conversations(@Query() q: { scene?: string; page?: string; pageSize?: string }) {
    return this.adminAi.conversations({ scene: q.scene, page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 20 });
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '会话回放：消息 + 工具调用 + 待确认操作' })
  conversationDetail(@Param('id', ParseIntPipe) id: number) {
    return this.adminAi.conversationDetail(id);
  }

  @Post('copywriting')
  @ApiOperation({ summary: '生成商品文案（style: student / professional / playful）' })
  copywriting(@Body() body: { productId: number; style?: string }) {
    return this.adminAi.copywriting(Number(body.productId), body.style);
  }

  @Get('insight')
  @ApiOperation({ summary: '经营快报：数据解读 + 一条可执行建议' })
  insight() {
    return this.adminAi.insight();
  }
}

@ApiTags('管理端-知识库')
@Controller('admin/knowledge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminKnowledgeController {
  constructor(private readonly adminAi: AdminAiService) {}

  @Get()
  @ApiOperation({ summary: '知识库列表' })
  list(@Query() q: { keyword?: string; scene?: string; page?: string; pageSize?: string }) {
    return this.adminAi.knowledgeList({
      keyword: q.keyword, scene: q.scene,
      page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 20,
    });
  }

  @Post()
  @ApiOperation({ summary: '新增知识条目（自动补向量）' })
  create(@Body() body: { scene?: string; title: string; source?: string; content: string }) {
    return this.adminAi.knowledgeCreate(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改知识条目' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.adminAi.knowledgeUpdate(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除知识条目' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.adminAi.knowledgeRemove(id);
  }

  @Post('reindex')
  @ApiOperation({ summary: '重建向量索引（配置了 embedding 模型才有效）' })
  reindex() {
    return this.adminAi.reindex();
  }
}

@ApiTags('管理端-商品与用户')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminShopController {
  constructor(private readonly shop: AdminShopService) {}

  @Get('products')
  @ApiOperation({ summary: '商品分页查询' })
  products(@Query() q: Record<string, string>) {
    return this.shop.productList({
      keyword: q.keyword, kind: q.kind, status: q.status,
      page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 10,
    });
  }

  @Post('products')
  @ApiOperation({ summary: '新增或更新商品（带 id 即更新）' })
  productSave(@Body() body: Record<string, unknown> & { id?: number }) {
    return this.shop.productSave(body);
  }

  @Post('products/:id/status')
  @ApiOperation({ summary: '上架 / 下架' })
  productToggle(@Param('id', ParseIntPipe) id: number, @Body() body: { status: 'on' | 'off' }) {
    return this.shop.productToggle(id, body.status);
  }

  @Get('categories')
  @ApiOperation({ summary: '分类列表' })
  categories() {
    return this.shop.categoryList();
  }

  @Post('categories')
  @ApiOperation({ summary: '新增或更新分类' })
  categorySave(@Body() body: { id?: number; name: string; slug: string; kind: string; sort?: number; enabled?: boolean }) {
    return this.shop.categorySave(body);
  }

  @Get('users')
  @ApiOperation({ summary: '用户分页查询' })
  users(@Query() q: Record<string, string>) {
    return this.shop.userList({
      keyword: q.keyword, role: q.role,
      page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 10,
    });
  }

  @Patch('users/:id')
  @ApiOperation({ summary: '修改用户状态或角色' })
  userUpdate(@Param('id', ParseIntPipe) id: number, @Body() body: { status?: number; role?: string; nickname?: string }) {
    return this.shop.userUpdate(id, body);
  }

  @Post('users/:id/balance')
  @ApiOperation({ summary: '调整余额（单位：分，可为负）' })
  adjustBalance(@Param('id', ParseIntPipe) id: number, @Body() body: { amountCents: number; remark?: string }) {
    return this.shop.userAdjustBalance(id, Number(body.amountCents), body.remark ?? '管理员调整');
  }
}
