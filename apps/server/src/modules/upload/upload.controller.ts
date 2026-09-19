import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * 图片上传：小程序把图片读成 base64 传上来，服务端落盘并返回可访问 URL。
 * 用 base64 而不是 multipart，是为了少引入一个中间件依赖 —— 交付时依赖越少越好。
 */
@ApiTags('上传')
@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  @Post()
  @ApiOperation({ summary: '上传图片（dataUrl），返回可访问 URL' })
  upload(@Body() body: { dataUrl: string; filename?: string }) {
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(body?.dataUrl ?? '');
    if (!match) throw new BadRequestException('dataUrl 格式应为 data:image/png;base64,...');

    const ext = EXT[match[1]];
    if (!ext) throw new BadRequestException('只支持 png / jpg / webp / gif');

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength > 5 * 1024 * 1024) throw new BadRequestException('图片不能超过 5MB');

    const folder = path.join(UPLOAD_ROOT, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(folder, { recursive: true });
    const name = randomUUID() + '.' + ext;
    fs.writeFileSync(path.join(folder, name), buffer);

    const relative = path.relative(UPLOAD_ROOT, path.join(folder, name)).split(path.sep).join('/');
    return { url: '/uploads/' + relative, size: buffer.byteLength };
  }
}
