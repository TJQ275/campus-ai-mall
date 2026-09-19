import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * 用 shared 包里的 Zod schema 校验入参，前后端共用同一份规则。
 *
 * 这是本项目唯一的运行时入参校验途径 —— 全局的 class-validator ValidationPipe 已移除，
 * 因为它需要 DTO 类与装饰器，而这里的入参都是 TS 接口（运行时被擦除），注册了也是空壳。
 *
 * 第二个泛型是 schema 的「输入类型」：带 .default() / z.coerce 的 schema 输入输出不一致，
 * 这里只关心校验结果，所以输入类型放宽成 any。
 *
 * 用法：@Body(new ZodValidationPipe(ChatRequest)) body: ChatRequest
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, any>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message)
        .join('; ');
      throw new BadRequestException('参数校验失败 -> ' + detail);
    }
    return parsed.data;
  }
}
