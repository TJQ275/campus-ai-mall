import './env.js';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { users } from './schema/index.js';
import { hashPassword } from '../common/password.js';

/**
 * 重置管理端密码：pnpm --filter @campus/server admin:password 新密码
 *
 * 默认改 username=admin 的账号；也可以用 --user 指定别的账号名。
 * 演示账号密码是公开写在文档里的，接手后第一件事就跑一次这个。
 */
async function main() {
  // 手写解析：只有一个位置参数和一个 --user 选项，不值得引依赖
  let username = 'admin';
  const positional: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--user') {
      username = args[i + 1] ?? 'admin';
      i += 1;
      continue;
    }
    positional.push(args[i]);
  }
  const password = positional[0];

  if (!password || password.length < 6) {
    console.error('用法：pnpm --filter @campus/server admin:password <新密码> [--user 账号名]');
    console.error('密码至少 6 位。');
    process.exit(1);
  }

  const handle = await createDb();
  const updated = await handle.db
    .update(users)
    .set({ passwordHash: hashPassword(password), updatedAt: new Date() })
    .where(eq(users.username, username))
    .returning({ id: users.id, nickname: users.nickname });

  if (!updated[0]) {
    console.error('[admin] 找不到账号「' + username + '」，请确认账号名是否正确。');
    await handle.close();
    process.exit(1);
  }

  console.log('[admin] 已重置「' + updated[0].nickname + '」（账号 ' + username + '）的登录密码。');
  console.log('[admin] 现在可以用新密码登录管理后台：http://localhost:5173');
  await handle.close();
}

main().catch((error) => {
  console.error('[admin] 重置失败:', error);
  process.exit(1);
});
