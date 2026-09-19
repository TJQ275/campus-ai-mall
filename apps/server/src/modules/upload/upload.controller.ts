import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UploadRequest } from '@campus/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * 判断二进制内容是否真的是图片。
 *
 * 只信 MIME 字符串是不够的 —— 这个目录会被静态托管出去，只要扩展名能对上，
 * 任何内容都会被浏览器按图片以外的类型解析。这里按魔术字节校验，只放行四种图片格式。
 */
function sniffImage(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  const riff = buffer.subarray(0, 4).toString('ascii') === 'RIFF';
  const webp = buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (riff && webp) return 'image/webp';
  return null;
}

/**
 * 图片上传：客户端把图片读成 base64 传上来，服务端落盘并返回可访问 URL。
 * 用 base64 而不是 multipart，是为了少引入一个中间件依赖 —— 交付时依赖越少越好。
 *
 * 两个配套设置都在 main.ts：JSON body 上限放宽到 8mb（默认 100kb 会让稍大的图直接 413）。
 */
@ApiTags('上传')
@Controller('upload')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class UploadController {
  @Post()
  @RateLimit({ limit: 30, windowMs: 60_000, by: 'user' })
  @ApiOperation({ summary: '上传图片（dataUrl），返回可访问 URL' })
  upload(@Body(new ZodValidationPipe(UploadRequest)) body: UploadRequest) {
    const match = /^data:(image\/[a-zA-Z+]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(body.dataUrl);
    if (!match) throw new BadRequestException('dataUrl 格式应为 data:image/png;base64,...');

    if (!EXT[match[1]]) throw new BadRequestException('只支持 png / jpg / webp / gif');

    // base64 字符串长度可以直接估算体积，避免先把超大内容解码进内存
    if (Math.ceil(match[2].length / 4) * 3 > MAX_BYTES) throw new BadRequestException('图片不能超过 5MB');

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength > MAX_BYTES) throw new BadRequestException('图片不能超过 5MB');

    // 声明的 MIME 必须和真实内容一致，两者取其一都不够
    const sniffed = sniffImage(buffer);
    if (!sniffed) throw new BadRequestException('这个文件看起来不是有效的图片');
    if (sniffed !== match[1] && !(sniffed === 'image/jpeg' && match[1] === 'image/jpg')) {
      throw new BadRequestException('文件内容与声明的图片格式不一致');
    }

    const ext = EXT[sniffed];
    const folder = path.join(UPLOAD_ROOT, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(folder, { recursive: true });
    const name = randomUUID() + '.' + ext;
    fs.writeFileSync(path.join(folder, name), buffer);

    const relative = path.relative(UPLOAD_ROOT, path.join(folder, name)).split(path.sep).join('/');
    return { url: '/uploads/' + relative, size: buffer.byteLength };
  }
}
