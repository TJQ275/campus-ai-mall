import './env.js';
import { createDb } from './client.js';
import { LlmService } from '../modules/ai/llm.service.js';
import { LlmConfigService } from '../modules/ai/llm-config.service.js';
import { EmbeddingService } from '../modules/ai/embedding.service.js';
import { AiUsageService } from '../modules/ai/usage.service.js';

/**
 * 向量补全：pnpm ai:embed
 * 给还没有向量的商品与知识库条目补 embedding。没配 LLM_EMBEDDING_MODEL 时直接跳过，
 * 检索会自动走关键词路径，不需要任何额外动作。
 */
async function main() {
  const handle = await createDb();
  // 脚本里手动装配：配置来源与线上一致（后台设置页保存的库配置 > .env）
  const llm = new LlmService(new LlmConfigService(handle.db));
  await llm.init();
  // 脚本里也接上记账，这样 ai:embed 补向量花的钱同样进账本
  const embedding = new EmbeddingService(handle.db, llm, new AiUsageService(handle.db));

  if (!embedding.enabled) {
    console.log('[embed] 未配置 LLM_EMBEDDING_MODEL，跳过。检索会自动使用关键词模式。');
    await handle.close();
    return;
  }

  const result = await embedding.backfill(500);
  console.log('[embed] 商品', result.products, '条，知识库', result.knowledge, '条，已写入向量');
  await handle.close();
}

main().catch((error) => {
  console.error('[embed] 失败:', error);
  process.exit(1);
});