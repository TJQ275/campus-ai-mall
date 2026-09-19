import 'dotenv/config';
import { createDb } from './client.js';
import { LlmService } from '../modules/ai/llm.service.js';
import { EmbeddingService } from '../modules/ai/embedding.service.js';

/**
 * 向量补全：pnpm ai:embed
 * 给还没有向量的商品与知识库条目补 embedding。没配 LLM_EMBEDDING_MODEL 时直接跳过，
 * 检索会自动走关键词路径，不需要任何额外动作。
 */
async function main() {
  const handle = await createDb();
  const llm = new LlmService();
  const embedding = new EmbeddingService(handle.db, llm);

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
