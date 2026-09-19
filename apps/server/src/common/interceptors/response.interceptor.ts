import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/** 统一响应包装：{ code: 0, message: 'ok', data } —— 小程序端只判断 code === 0 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, { code: number; message: string; data: T }> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<{ code: number; message: string; data: T }> {
    return next.handle().pipe(map((data) => ({ code: 0, message: 'ok', data })));
  }
}
