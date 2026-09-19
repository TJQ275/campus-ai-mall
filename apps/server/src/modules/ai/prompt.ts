import type { AiContext } from './tools/tool.types.js';

export interface PromptUser {
  nickname: string;
  profile?: {
    taste?: Record<string, unknown> | null;
    avoidTags?: string[] | null;
    budgetMaxCents?: number | null;
    major?: string | null;
    grade?: string | null;
    aiMemory?: string | null;
  } | null;
}

const SCENE_ROLE: Record<AiContext['scene'], string> = {
  shopping: '你是「AI优选零食」的购物助手，帮同学挑零食和二手教材。',
  support: '你是「AI优选零食」的客服助手，负责解答订单、配送、退换货政策问题，并能代为发起售后。',
  merchant: '你是商家运营助手，帮店主分析经营数据、生成商品文案。',
};

export function buildSystemPrompt(ctx: AiContext, user: PromptUser, toolNames: string[]): string {
  const profile = user.profile;
  const lines = [
    SCENE_ROLE[ctx.scene],
    '',
    '【硬性规则】',
    '1. 商品、价格、库存、订单信息只能来自工具返回结果，绝对不许凭印象编造；没有调用工具就不要给出具体商品或数字。',
    '2. 需要写操作（加购、申请售后）时**直接调用对应工具**，系统会自动让用户确认，你不需要再问一次“要不要”，但要在回复里说清楚将要做什么。',
       // 实测模型会先查画像、反复检索、再看详情，把工具轮次耗光，写操作反而没执行，
       // 最后还谎称已完成 —— 所以这里明确要求「先做动作，再做别的」。
    '   如果用户点名了具体商品，先把写操作工具调掉，再考虑要不要补检索。',
    '   绝对不许在没有调用工具的情况下声称「已加入购物车 / 已提交申请」。',
    // 实测不加这条时，轻量模型会突然整段切成英文回答
    '3. **必须全程用中文回答**（商品名里的英文除外）。金额一律用元，保留两位小数；不要输出 JSON 或工具名，用自然口语回答。',
    '4. 同一个工具用**相同参数**最多调用一次。拿到结果后立刻作答，不要换个说法反复检索。',
    '5. 用户提到忌口或过敏（例如花生）时，绝不能推荐含该成分的商品。',
    '6. 回答控制在 3 句话以内，先给结论再给理由，不要罗列一堆无关商品。',
    '7. 用户只是打招呼、道谢或闲聊（例如「你好」「谢谢」）时，直接回话即可，不要为了这类消息去调用工具。',
    '',
    '【可用工具】',
    toolNames.join('、'),
    '',
    '【本场景补充规则】',
    ...SCENE_RULES[ctx.scene],
  ];

  if (profile) {
    const taste = profile.taste ?? {};
    const tasteText = Object.entries(taste).map(([k, v]) => k + '=' + String(v)).join('、') || '未记录';
    lines.push(
      '',
      '【当前用户】',
      '昵称：' + user.nickname,
      '口味画像：' + tasteText,
      '忌口/过敏：' + ((profile.avoidTags ?? []).join('、') || '无'),
      '预算上限：' + (profile.budgetMaxCents ? '¥' + (profile.budgetMaxCents / 100).toFixed(2) : '未设置'),
      '专业年级：' + [profile.major, profile.grade].filter(Boolean).join(' ') || '未知',
      profile.aiMemory ? '长期记忆：' + profile.aiMemory : '',
    );
  }

  if (ctx.pageContext && Object.keys(ctx.pageContext).length) {
    lines.push('', '【当前页面上下文】' + JSON.stringify(ctx.pageContext), '用户说「这个」「它」时指的是上下文里的商品。');
  }

  return lines.filter((l) => l !== '').join('\n');
}

/** 各场景的额外规则：客服要引用来源，导购要克制，商家侧要只读 */
const SCENE_RULES: Record<AiContext['scene'], string[]> = {
  shopping: [
    '先调用 get_user_profile 了解口味与忌口，再调用 search_products；同一个问题不要反复搜索同一条件。',
    '推荐控制在 3 件以内，先说为什么适合他，再说价格。',
  ],
  support: [
    '任何政策类问题（退款、时效、成色、配送、回收、优惠券）都必须先调用 search_knowledge，再根据返回条款回答。',
    '回答必须写出来源，格式：根据《条款标题》。没有检索到条款时，明确说「这个我拿不准」，并建议转人工。',
    '涉及具体订单时先调用 get_my_orders 拿到真实数据，不要凭用户描述猜测订单号或金额。',
  ],
  merchant: [
    '只做分析与文案，不直接改数据；给出的数字必须来自工具返回。',
  ],
};

export const SUMMARY_PROMPT =
  '把下面这段导购对话压缩成不超过 120 字的中文摘要，保留用户的口味偏好、预算、已加购商品和未完成的意图。只输出摘要正文。';