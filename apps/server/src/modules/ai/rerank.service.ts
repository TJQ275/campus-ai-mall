import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { LlmConfigService } from './llm-config.service.js';
import { AiUsageService } from './usage.service.js';

/** 待重排的候选文档 */
export interface RerankCandidate {
  id: string;
  text: string;
  /** 召回阶段的分数。传了就让重排做 RRF 融合，不传就纯词法重排 */
  score?: number;
}

/** 重排超时。必须短 —— 它是「锦上添花」，不能拖慢用户等待 */
const RERANK_TIMEOUT_MS = 1200;

/**
 * 重排服务客户端（RAG 的「召回 → 重排」第二段）。
 *
 * 为什么用独立的 Python 服务而不是在 Node 里实现：
 *   1. 重排是**计算密集**且**可独立伸缩**的，和业务后端的扩缩容节奏不一样；
 *   2. Python 生态里现成的检索/排序库更多，后面想换 cross-encoder 不用动主工程；
 *   3. 它天然是个「可以挂」的依赖 —— 挂了大不了不重排，正好练一次优雅降级。
 *
 * 降级策略：**任何异常都返回 null**，调用方沿用原召回顺序。
 * 重排只是让排序更准，绝不能因为它挂了就让用户拿不到结果。
 */
@Injectable()
export class RerankService implements OnModuleInit {
  private readonly logger = new Logger(RerankService.name);
  private lastFailure: { message: string; at: number } | null = null;
  private lastSuccessAt: number | null = null;

  constructor(
    private readonly config: LlmConfigService,
    private readonly usage: AiUsageService,
  ) {}

  onModuleInit(): void {
    if (this.enabled) {
      this.logger.log('重排服务已启用: ' + this.baseUrl);
    } else {
      this.logger.log('未配置 RERANK_BASE_URL，跳过重排（召回顺序直出）。启动方式见 services/rerank/README.md');
    }
  }

  private get baseUrl(): string {
    return (this.config.current.rerankBaseUrl ?? '').replace(/\/+$/, '');
  }

  get enabled(): boolean {
    return Boolean(this.baseUrl);
  }

  health() {
    return {
      enabled: this.enabled,
      baseUrl: this.baseUrl || null,
      failing: Boolean(this.lastFailure),
      lastError: this.lastFailure?.message ?? null,
      lastErrorAt: this.lastFailure ? new Date(this.lastFailure.at).toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      hint: this.lastFailure
        ? '重排服务不可达时后端会自动跳过重排，检索仍然可用（只是排序质量下降）。启动：pwsh -File services/rerank/run.ps1'
        : null,
    };
  }

  /**
   * 对候选重排，返回前 topK 条。
   * 未启用、超时、服务报错、返回格式不对 —— 一律返回 null，由调用方保持原序。
   */
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankCandidate[] | null> {
    if (!this.enabled || candidates.length <= 1 || !query.trim()) return null;
    // 候选本来就不多于 topK，重排没有意义，省一次网络往返
    if (candidates.length <= topK) return null;

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

    try {
      const response = await fetch(this.baseUrl + '/rerank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query,
          topK,
          documents: candidates.map((c) => ({ id: c.id, text: c.text, originalScore: c.score })),
        }),
      });

      if (!response.ok) throw new Error('重排服务返回 ' + response.status);

      const json = (await response.json()) as { results?: { id: string; score: number }[] };
      if (!Array.isArray(json.results)) throw new Error('重排服务返回格式不对');

      // 按返回顺序映射回原候选，丢掉服务没认出来的 id（防御性处理）
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const ordered = json.results
        .map((r) => byId.get(r.id))
        .filter((c): c is RerankCandidate => Boolean(c));

      if (!ordered.length) throw new Error('重排结果为空');

      this.lastFailure = null;
      this.lastSuccessAt = Date.now();

      // 重排是本地计算，不花钱；但仍然记一笔，这样后台能看到「重排调了多少次、耗时多少」
      await this.usage.record({
        model: 'rerank:local',
        kind: 'rerank',
        latencyMs: Date.now() - started,
      });

      return ordered.slice(0, topK);
    } catch (error) {
      const message = (error as Error).name === 'AbortError'
        ? '重排超时（' + RERANK_TIMEOUT_MS + 'ms）'
        : ((error as Error).message ?? String(error));
      this.lastFailure = { message, at: Date.now() };
      this.logger.warn('重排失败，沿用原召回顺序: ' + message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
