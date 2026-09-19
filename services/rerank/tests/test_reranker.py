"""重排逻辑的单元测试。

跑法（在 services/rerank 目录下）：
    python -m pytest -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# 允许 python -m pytest 直接从 services/rerank 目录跑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.reranker import Document, bm25_scores, rerank, tokenize  # noqa: E402


# ==================== 分词 ====================

def test_tokenize_chinese_uses_bigrams() -> None:
    tokens = tokenize("满多少免运费")
    assert "运费" in tokens
    assert "免运" in tokens


def test_tokenize_short_chinese_kept_whole() -> None:
    # 「辣条」这类两字词如果只切滑窗会丢掉整体语义
    assert "辣条" in tokenize("辣条")


def test_tokenize_english_lowercased_and_dropped_if_single_char() -> None:
    tokens = tokenize("iPhone 15 A")
    assert "iphone" in tokens
    assert "15" in tokens
    assert "a" not in tokens, "单字母噪声太大，应该丢掉"


def test_tokenize_empty() -> None:
    assert tokenize("") == []
    assert tokenize("   ") == []


# ==================== BM25 ====================

def test_bm25_ranks_matching_document_higher() -> None:
    query = tokenize("退款")
    docs = [tokenize("这篇讲的是配送"), tokenize("退款政策：签收后 7 天无理由")]
    scores = bm25_scores(query, docs)
    assert scores[1] > scores[0]


def test_bm25_no_match_scores_zero() -> None:
    scores = bm25_scores(tokenize("高等数学"), [tokenize("零食 辣条 薯片")])
    assert scores[0] == 0.0


# ==================== 重排：真实场景 ====================

def test_rerank_puts_relevant_first() -> None:
    docs = [
        Document("a", "优惠券不可叠加使用，一单一张"),
        Document("b", "校园内下单 30 分钟送达自提柜"),
        Document("c", "零食类商品支持签收后 7 天内无理由退款"),
    ]
    top = rerank("退款政策是什么", docs, top_k=1)
    assert top[0].id == "c", "退款相关的那条应该排第一"


def test_rerank_handles_the_synonym_case_via_lexical_overlap() -> None:
    """
    评测 pol-16 的真实场景：用户问「满多少免运费」，知识库写的是「满 19 元免配送费」。

    注意这里断言的是**重排的正确行为**，而不是「能救回来」——
    「运费」和「配送费」字面不重叠，BM25 单独确实救不了（那是同义词表或语义检索的活）。
    但重排必须做到：把含「满 / 免 / 配送」这些重叠字的那条排到前面，而不是让无关条目顶上来。
    """
    docs = [
        Document("recycle", "毕业季支持教材回收，按定价的 30% 回收"),
        Document("delivery", "校园内 30 分钟送达自提柜。满 19 元免配送费，未满收取 1 元配送费"),
        Document("coupon", "优惠券不可叠加使用，一单一张"),
    ]
    ranked = rerank("满多少免运费", docs)
    assert ranked[0].id == "delivery", "含「满/免」的配送条款应该排第一"


def test_rerank_rrf_fusion_uses_original_rank() -> None:
    """
    给了 original_score 就走 RRF 融合。
    构造一个「词法完全打平、但召回分明确」的场景，验证召回排名确实被用上了。
    """
    docs = [
        Document("x", "无关内容一", original_score=0.10),
        Document("y", "无关内容二", original_score=0.95),
    ]
    ranked = rerank("完全打平的查询词", docs)
    assert ranked[0].id == "y", "词法打平时应该由召回分决定顺序"


def test_rerank_top_k_limits_results() -> None:
    docs = [Document(str(i), "文档 " + str(i) + " 零食") for i in range(10)]
    assert len(rerank("零食", docs, top_k=3)) == 3
    assert len(rerank("零食", docs)) == 10


def test_rerank_normalizes_scores_to_unit_range() -> None:
    docs = [Document("a", "辣条 辣条 辣条"), Document("b", "辣条"), Document("c", "薯片")]
    scores = [d.score for d in rerank("辣条", docs)]
    assert max(scores) == pytest.approx(1.0)
    assert min(scores) == pytest.approx(0.0)


def test_rerank_equal_scores_do_not_crash() -> None:
    # 两条完全一样的文本，归一化时 hi-lo=0，不能除零
    docs = [Document("a", "一样的"), Document("b", "一样的")]
    ranked = rerank("一样的", docs)
    assert len(ranked) == 2
    assert all(0.0 <= d.score <= 1.0 for d in ranked)


def test_rerank_empty_inputs() -> None:
    assert rerank("查询", []) == []
    # 空查询：原样返回，不排序
    docs = [Document("a", "内容")]
    assert len(rerank("", docs)) == 1
