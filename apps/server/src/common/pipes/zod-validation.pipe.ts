import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** 用 shared 包里的 Zod schema 校验入参，前后端共用同一份规则 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ');
      throw new BadRequestException('参数校验失败 -> ' + detail);
    }
    return parsed.data;
  }
}
