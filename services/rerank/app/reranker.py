"""
重排（rerank）核心逻辑。

为什么需要重排：向量召回擅长「找得到」，但不擅长「排得准」。
把 top-20 直接丢给模型，最相关的那条可能排在第 7 位，模型的注意力会被稀释。
重排就是拿一个**更准但更慢**的打分器，把这 20 条重新排一遍，只取前几条。

这里默认用 BM25（词法打分），原因有三：
  1. 纯标准库实现，零重依赖 —— 不需要下载模型，国内网络也能跑
  2. 确定性、可解释，出问题能逐项对分
  3. 与向量召回**互补**：向量管语义（「运费」≈「配送费」），BM25 管精确词面
     （型号、ISBN、政策编号这种必须字面命中的东西，纯向量反而容易漏）

如果调用方同时给了向量分，就走 RRF 融合两者，而不是二选一。

想换成 cross-encoder（更强的语义重排）时，只要实现 same 接口的 score() 即可，
见 README 的「换成 cross-encoder」一节。
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Iterable, Sequence

# BM25 参数：k1 控制词频饱和，b 控制文档长度归一化。用业界常用默认值。
BM25_K1 = 1.5
BM25_B = 0.75

# RRF 的平滑常数。原论文推荐 60，作用是压低头部排名的绝对优势，让两路结果更均衡。
RRF_K = 60

_CJK = re.compile(r"[\u4e00-\u9fa5]+")
_ALNUM = re.compile(r"[a-zA-Z0-9]+")


def tokenize(text: str) -> list[str]:
    """
    中英混合分词。

    中文按 **2 字滑窗**（不引入 jieba 这类依赖），英文数字按整词小写。
    这与后端 TS 侧的分词策略保持一致 —— 两边对同一个查询切出同样的词，
    否则「Node 里检索到的」和「Python 里重排算的」会对不上，分数没有意义。
    """
    if not text:
        return []
    tokens: list[str] = []

    for run in _CJK.findall(text):
        if len(run) <= 3:
            # 短词整体保留，避免「辣条」被切成无意义的单字
            tokens.append(run)
        # 单字 + 双字**都要**。
        # 只切双字会漏掉一种常见情况：查询是长句（切成双字），
        # 而文档里那个字是独立成词的（例如「满 19 元免配送费」里的「满」是单字 run）。
        # 两边一个 token 都对不上，BM25 全是 0，重排就失去依据了 —— 这是实测踩到的。
        # 单字带来的噪声由 BM25 的 IDF 自然压下去（「的」「了」这类词 IDF 极低）。
        tokens.extend(run)
        for i in range(len(run) - 1):
            tokens.append(run[i : i + 2])

    for word in _ALNUM.findall(text):
        if len(word) >= 2:
            tokens.append(word.lower())

    return tokens


@dataclass
class Document:
    """待重排的文档。original_score 是召回阶段的分数（可选），用于 RRF 融合。"""

    id: str
    text: str
    original_score: float | None = None


@dataclass
class ScoredDocument:
    id: str
    score: float
    lexical_score: float
    original_score: float | None


def bm25_scores(query_tokens: Sequence[str], docs: Sequence[Sequence[str]]) -> list[float]:
    """
    标准 BM25。语料就是这一批候选文档 —— 重排是「在小候选集内重新排序」，
    不是从全库里检索，所以用候选集本身算 IDF 是合理且常见的做法。
    """
    n = len(docs)
    if n == 0:
        return []

    avg_len = sum(len(d) for d in docs) / n or 1.0

    # 文档频率：某个词出现在多少篇文档里
    df: dict[str, int] = {}
    for doc in docs:
        for term in set(doc):
            df[term] = df.get(term, 0) + 1

    scores: list[float] = []
    for doc in docs:
        length = len(doc) or 1
        tf: dict[str, int] = {}
        for term in doc:
            tf[term] = tf.get(term, 0) + 1

        score = 0.0
        for term in query_tokens:
            freq = tf.get(term, 0)
            if freq == 0:
                continue
            # IDF：加 1 平滑，避免高频词算出负数
            idf = math.log(1 + (n - df.get(term, 0) + 0.5) / (df.get(term, 0) + 0.5))
            denom = freq + BM25_K1 * (1 - BM25_B + BM25_B * length / avg_len)
            score += idf * (freq * (BM25_K1 + 1)) / denom
        scores.append(score)

    return scores


def _normalize(values: Iterable[float]) -> list[float]:
    """把分数压到 0..1，方便和 RRF 分量、以及前端展示对齐。全相等时统一给 1.0。"""
    items = list(values)
    if not items:
        return []
    lo, hi = min(items), max(items)
    if hi - lo < 1e-12:
        return [1.0 if hi > 0 else 0.0 for _ in items]
    return [(v - lo) / (hi - lo) for v in items]


def rerank(
    query: str,
    documents: Sequence[Document],
    top_k: int | None = None,
) -> list[ScoredDocument]:
    """
    对候选文档重排。

    打分策略：
      - 词法分：BM25
      - 若调用方给了 original_score：用 RRF 把「词法排名」和「原召回排名」融合
        （用排名而不是原始分数，是因为两路分数的量纲根本不可比）

    返回按分数降序排列的结果；top_k 为 None 时返回全部。
    """
    if not documents:
        return []

    query_tokens = tokenize(query)
    doc_tokens = [tokenize(d.text) for d in documents]
    lexical = bm25_scores(query_tokens, doc_tokens)

    has_original = any(d.original_score is not None for d in documents)

    # 词法完全没有信号（所有文档都 0 分）时，这批文档的「词法排名」纯属输入顺序，
    # 拿它去做 RRF 融合等于往结果里掺噪声：它会和召回排名正好互相抵消，
    # 最后融合出一个死平，排序退化回输入顺序。此时直接尊重召回顺序更诚实。
    lexical_has_signal = any(s > 0 for s in lexical)

    if not has_original or not lexical_has_signal:
        if has_original and not lexical_has_signal:
            # 有召回分就按召回分排；都没有就保持原序
            order = sorted(
                range(len(documents)),
                key=lambda i: (documents[i].original_score or 0.0),
                reverse=True,
            )
            lexical = [lexical[i] for i in order]
            documents = [documents[i] for i in order]
        normalized = _normalize(lexical)
        results = [
            ScoredDocument(d.id, round(s, 6), round(raw, 6), d.original_score)
            for d, s, raw in zip(documents, normalized, lexical)
        ]
    else:
        # RRF 融合：只看排名，不看分数量纲
        lexical_order = sorted(range(len(documents)), key=lambda i: lexical[i], reverse=True)
        lexical_rank = {idx: r for r, idx in enumerate(lexical_order)}

        original_values = [d.original_score if d.original_score is not None else float("-inf") for d in documents]
        original_order = sorted(range(len(documents)), key=lambda i: original_values[i], reverse=True)
        original_rank = {idx: r for r, idx in enumerate(original_order)}

        fused: list[float] = []
        for i in range(len(documents)):
            score = 1.0 / (RRF_K + lexical_rank[i] + 1)
            if documents[i].original_score is not None:
                score += 1.0 / (RRF_K + original_rank[i] + 1)
            fused.append(score)

        # 融合分本身数值很小（1/60 量级），归一化后更直观
        normalized = _normalize(fused)
        results = [
            ScoredDocument(d.id, round(n, 6), round(raw, 6), d.original_score)
            for d, n, raw in zip(documents, normalized, lexical)
        ]

    results.sort(key=lambda r: r.score, reverse=True)
    return results[:top_k] if top_k else results
