import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * 密码哈希（scrypt + 随机盐）。
 *
 * 单独放一个无依赖模块，而不是挂在 AuthService 上：
 * 一是 seed 脚本与单元测试都要用它（放在 service 里会把 NestJS、数据库驱动
 * 甚至 PGlite 的 WASM 运行时一起拖进来），二是这类纯函数本来就该独立可测。
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [algorithm, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
