# 重排服务（Python / FastAPI）

RAG 的「召回 → **重排**」中的第二段。后端 TS 侧先粗召回，把候选丢到这里重新排序，
取前几条再喂给模型。

## 为什么单独做成一个服务

| 理由 | 说明 |
|---|---|
| **计算特性不同** | 重排是 CPU 密集且可独立伸缩的，和业务后端的扩缩容节奏不一样 |
| **生态差异** | Python 的检索 / 排序库更丰富，以后换 cross-encoder 不用动主工程 |
| **天然可降级** | 它是个「可以挂」的依赖 —— 挂了就不重排，正好练一次优雅降级 |

## 起服务

`powershell
pwsh -File services/rerank/run.ps1          # 默认 3200
`

依赖在 `requirements.txt` 里，但**实际上零重依赖**：

`powershell
pip install -r services/rerank/requirements.txt
`

> 重要：**不需要下载任何模型权重**。国内网络拉 HuggingFace 基本会卡死，
> 所以默认实现是纯算法的 BM25，装完即用。

## 接口

`http
GET /health
→ { "status": "ok", "model": "bm25-uni+bigram+rrf", "version": "1.0.0" }

POST /rerank
{
  "query": "满多少免运费",
  "documents": [
    { "id": "delivery", "text": "满 19 元免配送费", "originalScore": 0.82 },
    { "id": "coupon",   "text": "优惠券不可叠加使用" }
  ],
  "topK": 3
}
→ {
  "results": [
    { "id": "delivery", "score": 1.0, "lexicalScore": 4.36, "originalScore": 0.82 }
  ],
  "model": "bm25-uni+bigram+rrf",
  "tookMs": 0
}
`

`originalScore` 是召回阶段的分数，传了就让服务做 RRF 融合，不传就纯词法重排。

## 打分策略

**词法分：BM25**（k1=1.5, b=0.75），中文按**单字 + 双字**切分。

> 单字和双字都要，这是踩出来的：只切双字时，查询「满多少免运费」切成长句的双字组合，
> 而文档里「满 19 元免配送费」的「满」是**独立成词的单字 run**，两边一个 token 都对不上，
> BM25 全 0，重排直接失去依据。

**融合：RRF**（k=60）。当调用方给了 `originalScore` 时，把「词法排名」和「原召回排名」
用 Reciprocal Rank Fusion 融合 —— 用**排名**而不是原始分数，因为两路分数的量纲根本不可比。

**词法无信号时不融合**：如果所有候选的 BM25 都是 0，那这批文档的「词法排名」纯属输入顺序，
拿它融合等于掺噪声（它会和召回排名正好互相抵消，融出一个死平）。此时直接尊重召回顺序。

## 测试

`powershell
cd services/rerank
python -m pytest -q        # 13 条
`

覆盖分词、BM25 排序、真实漏检场景、RRF 融合、归一化边界（全相等时不能除零）、空输入。

## 怎么接上后端

后端读 `RERANK_BASE_URL`（`.env` 或后台「AI 设置」页）：

`bash
RERANK_BASE_URL=http://127.0.0.1:3200
`

留空 = 不重排，召回顺序直出，**功能不受影响**。

后端侧的降级行为由 `apps/server/src/modules/ai/rerank.service.ts` 保证，有 10 条测试覆盖：
未配置、候选太少、超时、5xx、返回格式不对、返回的 id 全不认识 —— 一律返回 `null`，
调用方沿用原召回顺序，并在后台标红告警。

## 换成 cross-encoder

想要更强的语义重排时，只需要替换 `app/reranker.py` 里的 `rerank()` 实现，
保持入参出参不变即可。大致步骤：

1. `pip install sentence-transformers`（首次会下载模型，注意网络）
2. 在 `rerank()` 里用 cross-encoder 对 (query, doc) 逐对打分
3. **保留现在的 BM25 作为兜底**：模型加载失败时自动退回，不要让服务起不来

这也是保持 `/rerank` 接口不变的原因 —— 换实现不影响调用方。
`RERANK_MODEL` 环境变量用来标识当前实际使用的模型，会出现在 `/health` 里。
