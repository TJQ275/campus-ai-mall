/**
 * 模型价目表与 token → 费用换算。
 *
 * 为什么单独一个文件：价格是**会变的商业信息**，和业务逻辑混在一起以后没人敢改。
 * 独立出来后，运营改价只动这一个文件，改完更新 PRICE_TABLE_VERSION 即可对账。
 *
 * 金额单位统一用**微元**（micro-yuan，1 元 = 1_000_000）。
 * 原因：一次对话可能只花 0.0004 元，用浮点存会累积误差，
 * 用整数存则「分」太小、「厘」也不够，微元刚好能精确表示且不会溢出 int4。
 */

/** 价目表版本：改了价格就更新这个，历史账单能对上当时用的是哪版 */
export const PRICE_TABLE_VERSION = '2026-09';

export interface ModelPrice {
  /** 模型名匹配规则（不区分大小写的子串匹配） */
  match: string;
  label: string;
  /** 每百万输入 token 的价格 */
  inputPerMillion: number;
  /** 每百万输出 token 的价格 */
  outputPerMillion: number;
  currency: 'CNY' | 'USD';
  note?: string;
}

/**
 * 价目表。金额都按「每百万 token」计。
 *
 * 数据来源是各家公开定价页，**仅供参考** —— 实际以你账单为准，不一致就直接改这里。
 * 匹配规则：越长的 match 优先级越高（所以 deepseek-reasoner 会赢过 deepseek）。
 */
export const MODEL_PRICES: ModelPrice[] = [
  // ---------- 本地部署：不花钱 ----------
  { match: 'ollama', label: '本地 Ollama', inputPerMillion: 0, outputPerMillion: 0, currency: 'CNY', note: '本地推理，只耗电' },
  { match: 'qwen2.5', label: '本地 Qwen2.5', inputPerMillion: 0, outputPerMillion: 0, currency: 'CNY', note: '本地推理，只耗电' },
  { match: 'nomic-embed', label: '本地 nomic-embed', inputPerMillion: 0, outputPerMillion: 0, currency: 'CNY', note: '本地推理' },

  // ---------- DeepSeek ----------
  { match: 'deepseek-reasoner', label: 'DeepSeek R1', inputPerMillion: 4, outputPerMillion: 16, currency: 'CNY' },
  { match: 'deepseek-chat', label: 'DeepSeek V3', inputPerMillion: 2, outputPerMillion: 8, currency: 'CNY', note: '按缓存未命中的价格算' },
  { match: 'deepseek-flash', label: 'DeepSeek Flash', inputPerMillion: 1, outputPerMillion: 4, currency: 'CNY', note: '轻量快速版；价格如与账单不符请改这里' },
  { match: 'deepseek', label: 'DeepSeek', inputPerMillion: 2, outputPerMillion: 8, currency: 'CNY' },

  // ---------- 阿里云通义 ----------
  { match: 'qwen-vl', label: '通义千问 VL（视觉）', inputPerMillion: 1.5, outputPerMillion: 4.5, currency: 'CNY' },
  { match: 'qwen-max', label: '通义千问 Max', inputPerMillion: 2.4, outputPerMillion: 9.6, currency: 'CNY' },
  { match: 'qwen-plus', label: '通义千问 Plus', inputPerMillion: 0.8, outputPerMillion: 2, currency: 'CNY' },
  { match: 'qwen-turbo', label: '通义千问 Turbo', inputPerMillion: 0.3, outputPerMillion: 0.6, currency: 'CNY' },
  { match: 'text-embedding-v', label: '通义向量', inputPerMillion: 0.7, outputPerMillion: 0, currency: 'CNY', note: '向量模型只按输入计费' },

  // ---------- 月之暗面 Kimi ----------
  { match: 'moonshot-v1-128k', label: 'Kimi 128k', inputPerMillion: 60, outputPerMillion: 60, currency: 'CNY' },
  { match: 'moonshot-v1-32k', label: 'Kimi 32k', inputPerMillion: 24, outputPerMillion: 24, currency: 'CNY' },
  { match: 'moonshot-v1-8k', label: 'Kimi 8k', inputPerMillion: 12, outputPerMillion: 12, currency: 'CNY' },
  { match: 'moonshot', label: 'Kimi', inputPerMillion: 12, outputPerMillion: 12, currency: 'CNY' },

  // ---------- 智谱 GLM ----------
  { match: 'glm-4v', label: 'GLM-4V（视觉）', inputPerMillion: 1, outputPerMillion: 1, currency: 'CNY' },
  { match: 'glm-4-flash', label: 'GLM-4-Flash', inputPerMillion: 0, outputPerMillion: 0, currency: 'CNY', note: '官方免费模型' },
  { match: 'glm-4-plus', label: 'GLM-4-Plus', inputPerMillion: 50, outputPerMillion: 50, currency: 'CNY' },
  { match: 'glm-4', label: 'GLM-4', inputPerMillion: 50, outputPerMillion: 50, currency: 'CNY' },
  { match: 'embedding-3', label: 'GLM 向量', inputPerMillion: 0.5, outputPerMillion: 0, currency: 'CNY' },

  // ---------- OpenAI（按美元计价） ----------
  { match: 'gpt-4o-mini', label: 'GPT-4o mini', inputPerMillion: 0.15, outputPerMillion: 0.6, currency: 'USD' },
  { match: 'gpt-4o', label: 'GPT-4o', inputPerMillion: 2.5, outputPerMillion: 10, currency: 'USD' },
  { match: 'text-embedding-3-small', label: 'OpenAI 向量 small', inputPerMillion: 0.02, outputPerMillion: 0, currency: 'USD' },
  { match: 'text-embedding-3-large', label: 'OpenAI 向量 large', inputPerMillion: 0.13, outputPerMillion: 0, currency: 'USD' },
];

/** 表里没有的模型用这个兜底：宁可高估也不要漏记，避免账单悄悄失控 */
export const FALLBACK_PRICE: ModelPrice = {
  match: '*',
  label: '未知模型（按 DeepSeek 价估算）',
  inputPerMillion: 2,
  outputPerMillion: 8,
  currency: 'CNY',
};

/** 美元折算汇率。写死会有偏差，所以允许用环境变量覆盖 */
export function usdToCny(): number {
  const raw = Number(process.env.USD_TO_CNY);
  return Number.isFinite(raw) && raw > 0 ? raw : 7.2;
}

/** 按「最长匹配优先」找价目：deepseek-reasoner 必须赢过 deepseek */
export function resolvePrice(model: string | null | undefined): ModelPrice {
  const name = (model ?? '').toLowerCase().trim();
  if (!name) return FALLBACK_PRICE;
  let best: ModelPrice | null = null;
  for (const price of MODEL_PRICES) {
    if (!name.includes(price.match.toLowerCase())) continue;
    if (!best || price.match.length > best.match.length) best = price;
  }
  return best ?? FALLBACK_PRICE;
}

/**
 * 算一次调用的费用，返回**微元**整数。
 *
 * 推导（设价格单位是「元/百万 token」）：
 *   费用(元)   = promptTokens / 1e6 * 输入价 + completionTokens / 1e6 * 输出价
 *   费用(微元) = 费用(元) * 1e6 = promptTokens * 输入价 + completionTokens * 输出价
 * 所以不用真的除再乘，直接相乘即可 —— 这也是选微元做单位的原因之一。
 */
export function estimateCostMicro(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
): { costMicro: number; price: ModelPrice } {
  const price = resolvePrice(model);
  const rate = price.currency === 'USD' ? usdToCny() : 1;
  const input = Math.max(0, Math.trunc(promptTokens) || 0);
  const output = Math.max(0, Math.trunc(completionTokens) || 0);
  const costMicro = Math.round((input * price.inputPerMillion + output * price.outputPerMillion) * rate);
  return { costMicro, price };
}

/** 微元 → 人类可读（后台展示用） */
export function formatCost(costMicro: number, digits = 4): string {
  const yuan = (costMicro || 0) / 1_000_000;
  if (yuan === 0) return '¥0';
  if (yuan < 0.01) return '¥' + yuan.toFixed(digits);
  return '¥' + yuan.toFixed(2);
}

/** 价目表导出给后台展示 */
export function listPrices() {
  return {
    version: PRICE_TABLE_VERSION,
    usdToCny: usdToCny(),
    items: [...MODEL_PRICES, FALLBACK_PRICE],
  };
}
