import 'dotenv/config';
import { randomBytes, scryptSync } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, ensureVectorExtension, type Db } from './client.js';
import * as t from './schema/index.js';

/**
 * 演示数据：pnpm db:seed
 *
 * 两条业务线一起灌：零食（辣味/膨化/饮料/速食）+ 二手书（教材/考研/外语/文学）。
 * 另外写入售后政策知识库、演示订单、演示评论，以及一段带工具调用的 AI 会话，
 * 让管理后台的「AI 调用日志」一打开就有数据可看。
 */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

const IMG = (seed: string) => 'https://picsum.photos/seed/' + seed + '/600/600';

async function main() {
  const handle = await createDb();
  const db: Db = handle.db;
  await ensureVectorExtension(handle);
  console.log('[seed] driver =', handle.driver);

  // 幂等：先清空业务数据（保留表结构）
  await db.execute(sql`
    truncate table
      ai_feedback, ai_pending_action, ai_tool_call, ai_message, ai_conversation, ai_knowledge,
      wallet_log, after_sale, payment, order_item, \"order\", cart_item, review_summary, review,
      product_tag, tag, product_image, product_sku, product, category,
      user_behavior, address, user_profile, app_user,
      operation_log, login_log, notification, sys_config, sys_menu
    restart identity cascade
  `);

  // ── 用户 ──
  const [admin, zhang, li, wang] = await db.insert(t.users).values([
    { username: 'admin', passwordHash: hashPassword('admin123'), nickname: '校园小卖部管理员', role: 'admin', avatar: IMG('admin') },
    { openid: 'demo-openid-1', nickname: '张小明', role: 'user', balanceCents: 5000, avatar: IMG('stu1') },
    { openid: 'demo-openid-2', nickname: '李思思', role: 'user', balanceCents: 8000, avatar: IMG('stu2') },
    { openid: 'demo-openid-3', nickname: '王大力', role: 'user', balanceCents: 1200, avatar: IMG('stu3') },
  ]).returning();

  await db.insert(t.userProfiles).values([
    {
      userId: zhang.id,
      taste: { spicy: 5, sweet: 2, flavors: ['辣', '咸'] },
      avoidTags: ['花生'],
      budgetMaxCents: 2000,
      major: '计算机科学与技术',
      grade: '大二',
      preferredKinds: ['snack', 'book'],
      aiMemory: '大二计算机专业，爱吃辣，对花生过敏，买书集中在计算机专业课和考研资料上，预算敏感。',
    },
    {
      userId: li.id,
      taste: { spicy: 1, sweet: 5, flavors: ['甜'] },
      avoidTags: [],
      budgetMaxCents: 3000,
      major: '汉语言文学',
      grade: '大三',
      preferredKinds: ['book'],
      aiMemory: '汉语言文学专业，不太能吃辣，偏爱甜食，主要买文学类二手书。',
    },
    { userId: wang.id, taste: { spicy: 3 }, preferredKinds: ['snack'] },
  ]);

  await db.insert(t.addresses).values([
    { userId: zhang.id, receiver: '张小明', phone: '13800000001', campus: '东校区 3 号宿舍楼', detail: '412 室', isDefault: true },
    { userId: li.id, receiver: '李思思', phone: '13800000002', campus: '西校区 6 号宿舍楼', detail: '208 室', isDefault: true },
    { userId: wang.id, receiver: '王大力', phone: '13800000003', campus: '东校区 1 号宿舍楼', detail: '101 室', isDefault: true },
  ]);

  // ── 分类 ──
  const snackCats = await db.insert(t.categories).values([
    { name: '辣味零食', slug: 'snack-spicy', kind: 'snack', sort: 1, icon: 'fire-o' },
    { name: '膨化饼干', slug: 'snack-chips', kind: 'snack', sort: 2, icon: 'gift-o' },
    { name: '饮料冲调', slug: 'snack-drink', kind: 'snack', sort: 3, icon: 'smile-o' },
    { name: '方便速食', slug: 'snack-instant', kind: 'snack', sort: 4, icon: 'clock-o' },
    { name: '坚果果干', slug: 'snack-nuts', kind: 'snack', sort: 5, icon: 'flower-o' },
  ]).returning();
  const bookCats = await db.insert(t.categories).values([
    { name: '公共基础课', slug: 'book-basic', kind: 'book', sort: 1, icon: 'records' },
    { name: '计算机专业课', slug: 'book-cs', kind: 'book', sort: 2, icon: 'desktop-o' },
    { name: '考研考证', slug: 'book-exam', kind: 'book', sort: 3, icon: 'medal-o' },
    { name: '外语学习', slug: 'book-lang', kind: 'book', sort: 4, icon: 'font-o' },
    { name: '文学课外', slug: 'book-lit', kind: 'book', sort: 5, icon: 'bookmark-o' },
  ]).returning();
  const cat = (slug: string) => [...snackCats, ...bookCats].find((c) => c.slug === slug)!.id;

  // ── 标签 ──
  const tagRows = await db.insert(t.tags).values([
    { name: '辣', kind: 'taste', weight: 10 },
    { name: '甜', kind: 'taste', weight: 8 },
    { name: '咸', kind: 'taste', weight: 6 },
    { name: '宿舍必备', kind: 'scene', weight: 12 },
    { name: '熬夜续命', kind: 'scene', weight: 9 },
    { name: '期末救急', kind: 'scene', weight: 9 },
    { name: '预算友好', kind: 'crowd', weight: 7 },
    { name: '考研', kind: 'course', weight: 10 },
    { name: '有笔记', kind: 'other', weight: 8 },
    { name: '教材', kind: 'course', weight: 10 },
  ]).returning();
  const tag = (name: string) => tagRows.find((r) => r.name === name)!.id;

  // ── 商品：零食 ──
  const snackSeed: Array<[string, string, string, number, number, number, number, number, string[]]> = [
    ['卫龙大面筋辣条 106g', 'snack-spicy', '国民辣条，香辣有嚼劲', 350, 450, 200, 4, 186, ['辣', '宿舍必备']],
    ['麻辣王子地道辣条 110g', 'snack-spicy', '正宗平江麻辣，后劲足', 400, 500, 150, 5, 142, ['辣', '熬夜续命']],
    ['卫龙魔芋爽 香辣 252g', 'snack-spicy', '低卡解馋，热量友好', 990, 1290, 90, 4, 98, ['辣', '预算友好']],
    ['乐事薯片 原味 70g', 'snack-chips', '经典原味，脆到掉渣', 550, 650, 180, 0, 210, ['咸', '宿舍必备']],
    ['可比克薯片 烧烤味 60g', 'snack-chips', '烧烤风味，越吃越上头', 500, 600, 160, 1, 133, ['咸']],
    ['奥利奥夹心饼干 116g', 'snack-chips', '扭一扭泡一泡', 650, 750, 140, 0, 176, ['甜']],
    ['好丽友派 巧克力 6枚', 'snack-chips', '课间加餐首选', 990, 1200, 80, 0, 88, ['甜', '预算友好']],
    ['旺仔牛奶 245ml', 'snack-drink', '甜甜的童年味道', 500, 550, 240, 0, 195, ['甜']],
    ['康师傅冰红茶 500ml', 'snack-drink', '冰镇更爽', 350, 400, 300, 0, 240, ['甜', '宿舍必备']],
    ['元气森林 白桃味 480ml', 'snack-drink', '0 糖 0 脂 0 卡', 550, 600, 120, 0, 112, ['甜']],
    ['康师傅红烧牛肉面 桶装', 'snack-instant', '热水一冲就好', 500, 550, 260, 2, 320, ['咸', '熬夜续命', '宿舍必备']],
    ['白象大骨面 五连包', 'snack-instant', '囤货装更划算', 1390, 1690, 70, 1, 76, ['预算友好', '宿舍必备']],
    ['三只松鼠每日坚果 750g', 'snack-nuts', '一天一包，复习补脑', 3990, 4990, 45, 0, 52, ['预算友好']],
    ['溜溜梅 青梅 20g', 'snack-nuts', '酸酸甜甜，开胃提神', 250, 300, 200, 0, 143, ['甜', '预算友好']],
    ['士力架 花生夹心 51g', 'snack-nuts', '饿货，来一条', 450, 500, 130, 0, 121, ['甜', '熬夜续命']],
  ];

  const snackRows = await db.insert(t.products).values(
    snackSeed.map(([title, slug, subtitle, price, original, stock, spicy, sales, tags]) => ({
      kind: 'snack' as const,
      categoryId: cat(slug),
      title,
      subtitle,
      description: subtitle + '。校园小卖部现货，下单后 30 分钟内送达宿舍楼下的自提点。',
      cover: IMG('snack-' + title.slice(0, 4)),
      images: [IMG('snack-' + title.slice(0, 4)), IMG('snack2-' + title.slice(0, 4))],
      priceCents: price,
      originalPriceCents: original,
      stock,
      sales,
      spicyLevel: spicy,
      spec: '标准装',
      shelfLifeDays: 180,
      tags,
      ratingAvg: 4.5,
      ratingCount: 12,
    })),
  ).returning();

  // ── 商品：二手书 ──
  const bookSeed: Array<[string, string, string, string, string, number, number, string, string, string, boolean]> = [
    ['高等数学（第七版）上册', '同济大学数学系', '高等教育出版社', '第七版', '高等数学（上）', 1800, 4700, 'like_new', '9787040396614', 'book-basic', false],
    ['线性代数（第六版）', '同济大学数学系', '高等教育出版社', '第六版', '线性代数', 1200, 3300, 'good', '9787040396607', 'book-basic', true],
    ['概率论与数理统计（第四版）', '盛骤 等', '高等教育出版社', '第四版', '概率论与数理统计', 1500, 3900, 'like_new', '9787040238969', 'book-basic', false],
    ['大学英语四级真题（2025.12）', '新东方', '浙江教育出版社', '2025版', '大学英语', 2000, 4500, 'good', '9787572212345', 'book-lang', true],
    ['新视野大学英语 读写教程 1', '郑树棠', '外语教学与研究出版社', '第四版', '大学英语', 1000, 3600, 'fair', '9787513556789', 'book-lang', true],
    ['数据结构（C 语言版）', '严蔚敏', '清华大学出版社', '第二版', '数据结构', 2200, 4500, 'good', '9787302147510', 'book-cs', true],
    ['计算机网络（第 8 版）', '谢希仁', '电子工业出版社', '第八版', '计算机网络', 2500, 5900, 'like_new', '9787121411776', 'book-cs', false],
    ['操作系统概念（第 9 版）', 'Silberschatz 等', '机械工业出版社', '第九版', '操作系统', 3000, 7900, 'good', '9787111604369', 'book-cs', true],
    ['深入理解计算机系统（第 3 版）', 'Randal E. Bryant', '机械工业出版社', '第三版', '计算机组成原理', 5500, 13900, 'like_new', '9787111544937', 'book-cs', false],
    ['C Primer Plus（第 6 版）中文版', 'Stephen Prata', '人民邮电出版社', '第六版', 'C 语言程序设计', 4000, 8900, 'good', '9787115390592', 'book-cs', true],
    ['考研数学复习全书（2027 版）', '李永乐', '国家开放大学出版社', '2027版', '考研数学', 3500, 7900, 'like_new', '9787304134567', 'book-exam', false],
    ['肖秀荣考研政治 1000 题', '肖秀荣', '国家开放大学出版社', '2027版', '考研政治', 1800, 4900, 'good', '9787304134789', 'book-exam', true],
    ['英语六级词汇闪过', '马德高', '安徽人民出版社', '2025版', '大学英语', 1200, 3200, 'like_new', '9787212109876', 'book-exam', false],
    ['平凡的世界（全三册）', '路遥', '北京十月文艺出版社', '2017版', '中国现当代文学', 2800, 9800, 'good', '9787530216781', 'book-lit', true],
  ];

  const bookRows = await db.insert(t.products).values(
    bookSeed.map(([title, author, publisher, edition, course, price, original, condition, isbn, slug, hasNotes]) => ({
      kind: 'book' as const,
      categoryId: cat(slug),
      title,
      subtitle: author + ' · ' + publisher + ' · ' + edition,
      description: '校园二手教材，' + (hasNotes ? '内含学长学姐手写笔记与重点标注，' : '') + '无缺页无泡水，可当面验书。',
      cover: IMG('book-' + isbn),
      images: [IMG('book-' + isbn), IMG('book2-' + isbn)],
      priceCents: price,
      originalPriceCents: original,
      stock: 1,
      sales: Math.floor(Math.random() * 20) + 3,
      isbn,
      author,
      publisher,
      edition,
      course,
      condition,
      hasNotes,
      tags: ['教材', course, hasNotes ? '有笔记' : '无笔记'],
      ratingAvg: 4.7,
      ratingCount: 8,
    })),
  ).returning();

  // ── SKU：二手书按「具体副本」，成色各不相同 ──
  await db.insert(t.productSkus).values(
    bookRows.map((b) => ({
      productId: b.id,
      name: b.condition === 'like_new' ? '九成新 · 无笔记' : b.condition === 'good' ? '七成新 · 少量笔记' : '五成新 · 笔记较多',
      priceCents: b.priceCents,
      stock: 1,
      condition: b.condition,
      sellerNote: b.hasNotes ? '笔记集中在重点章节，不影响阅读' : '书页干净，无涂写',
      attrs: { isbn: b.isbn, course: b.course },
    })),
  );
  await db.insert(t.productSkus).values(
    snackRows.slice(0, 6).map((p) => ({ productId: p.id, name: '标准装', priceCents: p.priceCents, stock: p.stock, attrs: {} })),
  );

  // ── 标签关联 ──
  const allProducts = [...snackRows, ...bookRows];
  const productTagValues: { productId: number; tagId: number }[] = [];
  for (const p of allProducts) {
    for (const name of p.tags ?? []) {
      const found = tagRows.find((r) => r.name === name);
      if (found) productTagValues.push({ productId: p.id, tagId: found.id });
    }
  }
  if (productTagValues.length) await db.insert(t.productTags).values(productTagValues);

  // ── 行为埋点（协同过滤的原料）──
  const behaviors: { userId: number; productId: number; type: string; weight: number }[] = [];
  const students = [zhang, li, wang];
  for (const stu of students) {
    for (const p of allProducts.sort(() => Math.random() - 0.5).slice(0, 10)) {
      behaviors.push({ userId: stu.id, productId: p.id, type: 'view', weight: 1 });
    }
  }
  await db.insert(t.userBehaviors).values(behaviors);

  // ── 演示订单 ──
  const [order1, order2, order3] = await db.insert(t.orders).values([
    {
      orderNo: 'C' + Date.now() + '001', userId: zhang.id, status: 'finished',
      totalCents: 1250, payCents: 1250, freightCents: 0, payChannel: 'balance', payStatus: 'paid',
      paidAt: new Date(Date.now() - 86400000 * 3), finishedAt: new Date(Date.now() - 86400000 * 2),
      addressSnapshot: { receiver: '张小明', phone: '13800000001', campus: '东校区 3 号宿舍楼', detail: '412 室' },
      source: 'miniapp',
    },
    {
      orderNo: 'C' + Date.now() + '002', userId: zhang.id, status: 'shipped',
      totalCents: 1800, payCents: 1800, freightCents: 0, payChannel: 'wechat', payStatus: 'paid',
      paidAt: new Date(Date.now() - 86400000), shippedAt: new Date(Date.now() - 3600000 * 6),
      addressSnapshot: { receiver: '张小明', phone: '13800000001', campus: '东校区 3 号宿舍楼', detail: '412 室' },
      source: 'ai',
    },
    {
      orderNo: 'C' + Date.now() + '003', userId: li.id, status: 'pending_pay',
      totalCents: 2800, payCents: 2800, freightCents: 0, payStatus: 'unpaid',
      addressSnapshot: { receiver: '李思思', phone: '13800000002', campus: '西校区 6 号宿舍楼', detail: '208 室' },
      source: 'miniapp',
    },
  ]).returning();

  const items = await db.insert(t.orderItems).values([
    { orderId: order1.id, productId: snackRows[0].id, titleSnapshot: snackRows[0].title, priceCents: 350, quantity: 2, coverSnapshot: snackRows[0].cover },
    { orderId: order1.id, productId: snackRows[3].id, titleSnapshot: snackRows[3].title, priceCents: 550, quantity: 1, coverSnapshot: snackRows[3].cover },
    { orderId: order2.id, productId: bookRows[0].id, titleSnapshot: bookRows[0].title, priceCents: 1800, quantity: 1, coverSnapshot: bookRows[0].cover },
    { orderId: order3.id, productId: bookRows[1].id, titleSnapshot: bookRows[1].title, priceCents: 1200, quantity: 1, coverSnapshot: bookRows[1].cover },
    { orderId: order3.id, productId: snackRows[10].id, titleSnapshot: snackRows[10].title, priceCents: 500, quantity: 1, coverSnapshot: snackRows[10].cover },
    { orderId: order3.id, productId: snackRows[7].id, titleSnapshot: snackRows[7].title, priceCents: 500, quantity: 1, coverSnapshot: snackRows[7].cover },
  ]).returning();

  await db.insert(t.payments).values([
    { orderId: order1.id, channel: 'balance', amountCents: 1250, status: 'success', tradeNo: 'BAL' + order1.id, paidAt: new Date() },
    { orderId: order2.id, channel: 'wechat', amountCents: 1800, status: 'success', tradeNo: 'WX' + order2.id, paidAt: new Date() },
  ]);

  await db.insert(t.walletLogs).values([
    { userId: zhang.id, type: 'recharge', amountCents: 5000, balanceAfter: 5000, remark: '模拟充值' },
    { userId: zhang.id, type: 'consume', amountCents: -1250, balanceAfter: 3750, refType: 'order', refId: order1.id, remark: '订单支付' },
  ]);

  await db.insert(t.afterSales).values({
    afterSaleNo: 'A' + Date.now() + '001', orderId: order1.id, orderItemId: items[1].id, userId: zhang.id,
    type: 'refund', reason: '不想要了', description: '买重复了，申请退款', amountCents: 550, status: 'pending', source: 'ai',
  });

  // ── 评论 + AI 摘要 ──
  await db.insert(t.reviews).values([
    { productId: snackRows[0].id, userId: zhang.id, rating: 5, content: '还是这个味，辣得过瘾，宿舍囤了十包。' },
    { productId: snackRows[0].id, userId: wang.id, rating: 4, content: '好吃就是有点油，晚上吃容易口渴。' },
    { productId: bookRows[0].id, userId: zhang.id, rating: 5, content: '书很新，笔记做得很整齐，比买新的省了三十块。' },
    { productId: bookRows[1].id, userId: li.id, rating: 4, content: '封面有点卷边，内页干净，能接受。' },
    { productId: snackRows[10].id, userId: wang.id, rating: 5, content: '热水一冲就好，宿舍常备，汤头够味。' },
    { productId: snackRows[10].id, userId: zhang.id, rating: 4, content: '味道不错，就是面量偏少，男生可能吃不饱。' },
    { productId: snackRows[10].id, userId: li.id, rating: 3, content: '有点咸，调料包我只放了一半。' },
    { productId: snackRows[3].id, userId: zhang.id, rating: 5, content: '原味最耐吃，追剧必备，一大包能撑一晚上。' },
    { productId: snackRows[3].id, userId: wang.id, rating: 4, content: '碎了几片，其他都还好。' },
    { productId: bookRows[5].id, userId: zhang.id, rating: 5, content: '严蔚敏这本笔记很多，考研复习直接用，省了整理时间。' },
    { productId: bookRows[5].id, userId: li.id, rating: 4, content: '书角有点磨，内容完整，价格很划算。' },
  ]);
  await db.insert(t.reviewSummaries).values([
    {
      productId: snackRows[0].id,
      summary: '经典辣条，味道稳定、辣度足，适合能吃辣的同学囤货；主要槽点是偏油，吃完容易口渴。',
      pros: ['辣得过瘾', '价格便宜', '囤货方便'],
      cons: ['偏油', '吃完口渴'],
      audience: '能吃辣、想囤零食的宿舍党',
      keywords: ['辣条', '便宜', '囤货'],
      ratingDist: { '5': 1, '4': 1 },
      reviewCount: 2,
      model: 'seed-demo',
    },
  ]);

  // ── 售后知识库（客服 RAG 的检索源）──
  await db.insert(t.aiKnowledge).values([
    { scene: 'support', title: '退款政策', source: 'policy/refund.md#1', content: '零食类商品支持签收后 7 天内无理由退款，前提是未拆封且不影响二次销售；已拆封的食品因食品安全要求不支持无理由退款。二手书支持 7 天无理由退货，但需保证书页完整、无新增涂写。' },
    { scene: 'support', title: '退款到账时效', source: 'policy/refund.md#2', content: '管理员审核通过后，余额支付即时到账；微信/支付宝模拟支付同样即时回到账户余额。审核一般在 24 小时内完成，超过 24 小时未处理系统会自动通过。' },
    { scene: 'support', title: '二手书成色说明', source: 'policy/book-condition.md', content: '九成新：几乎无翻阅痕迹，无笔记；七成新：有少量荧光笔标注，不影响阅读；五成新：笔记较多或封面有磨损，价格更低。所有二手书均支持当面验书。' },
    { scene: 'support', title: '配送与自提', source: 'policy/delivery.md', content: '校园内下单后 30 分钟内送达宿舍楼下的自提柜；也可选择到东校区小卖部自提。满 19 元免配送费，未满收取 1 元配送费。' },
    { scene: 'support', title: '教材回收', source: 'policy/recycle.md', content: '毕业季支持教材回收：提交 ISBN 与成色照片，审核通过后按定价的 30% 回收，款项直接进入钱包余额，可用于购买零食或其他二手书。' },
    { scene: 'support', title: '优惠券使用规则', source: 'policy/coupon.md', content: '优惠券不可叠加使用，一单一张；满减券按商品实付金额计算门槛，不含配送费；优惠券过期不补发。' },
    { scene: 'shopping', title: '辣度说明', source: 'guide/spicy.md', content: '商品辣度分为 0-5 级：0 不辣、1 微辣、2 轻辣、3 中辣、4 重辣、5 变态辣。AI 导购按用户口味画像推荐对应辣度。' },
    { scene: 'shopping', title: '预算搭配建议', source: 'guide/budget.md', content: '20 元以内可搭配：一包辣条 + 一瓶饮料 + 一包薯片，是宿舍夜宵的经典组合，客单价约 12-15 元。' },
  ]);

  // ── 演示 AI 会话：让「AI 调用日志」页面一打开就有数据 ──
  const [conv] = await db.insert(t.aiConversations).values({
    userId: zhang.id, scene: 'shopping', title: '想吃辣的，20 元以内',
    pageContext: { page: 'home' }, messageCount: 4, lastMessageAt: new Date(),
    rollingSummary: '用户想买辣味零食，预算 20 元以内，最终加购了 2 包卫龙大面筋和 1 瓶冰红茶。',
  }).returning();

  const [userMsg, assistantMsg] = await db.insert(t.aiMessages).values([
    { conversationId: conv.id, userId: zhang.id, role: 'user', content: '想吃辣的，20 元以内，最好能凑个夜宵组合', model: null },
    { conversationId: conv.id, userId: zhang.id, role: 'assistant', content: '给你配了一套夜宵组合：卫龙大面筋 106g（辣度 4）2 包 + 康师傅冰红茶 500ml 1 瓶，合计 12.00 元，还不到 20 元预算。要不要直接加购？', cards: [{ type: 'product', productId: snackRows[0].id, title: snackRows[0].title, priceCents: 350 }], model: 'deepseek-chat', promptTokens: 860, completionTokens: 96, latencyMs: 1420 },
  ]).returning();

  await db.insert(t.aiToolCalls).values([
    { conversationId: conv.id, messageId: assistantMsg.id, userId: zhang.id, toolName: 'search_products', args: { kind: 'snack', tags: ['辣'], priceMax: 2000 }, result: { count: 5, top: [snackRows[0].title, snackRows[1].title] }, status: 'ok', durationMs: 38 },
    { conversationId: conv.id, messageId: assistantMsg.id, userId: zhang.id, toolName: 'get_user_profile', args: {}, result: { taste: { spicy: 5 }, avoidTags: ['花生'], budgetMaxCents: 2000 }, status: 'ok', durationMs: 6 },
  ]);

  await db.insert(t.aiPendingActions).values({
    conversationId: conv.id, userId: zhang.id, actionType: 'add_to_cart',
    summary: '加购 卫龙大面筋辣条 106g × 2、康师傅冰红茶 500ml × 1，合计 ¥12.00',
    payload: { items: [{ productId: snackRows[0].id, quantity: 2 }, { productId: snackRows[8].id, quantity: 1 }] },
    status: 'pending', expiresAt: new Date(Date.now() + 600000),
  });

  // ── 系统数据 ──
  await db.insert(t.sysMenus).values([
    { name: '数据概览', path: '/dashboard', icon: 'DataLine', sort: 1 },
    { name: '商品管理', path: '/product', icon: 'Goods', sort: 2 },
    { name: '分类管理', path: '/category', icon: 'Menu', sort: 3 },
    { name: '订单管理', path: '/order', icon: 'List', sort: 4 },
    { name: '售后管理', path: '/after-sale', icon: 'RefreshLeft', sort: 5 },
    { name: '用户管理', path: '/user', icon: 'User', sort: 6 },
    { name: 'AI 调用日志', path: '/ai/logs', icon: 'MagicStick', sort: 7 },
    { name: 'AI 知识库', path: '/ai/knowledge', icon: 'Notebook', sort: 8 },
    { name: '系统日志', path: '/system/log', icon: 'Document', sort: 9 },
  ]);
  await db.insert(t.sysConfigs).values([
    { key: 'llm.enabled', value: 'true', remark: 'AI 助手总开关' },
    { key: 'llm.provider', value: 'openai-compatible', remark: '兼容 OpenAI 协议的任意服务' },
    { key: 'ai.autoConfirmWrite', value: 'false', remark: '写操作是否需要用户二次确认' },
  ]);

  const counts = await db.execute(sql`
    select
      (select count(*) from product) as products,
      (select count(*) from app_user) as users,
      (select count(*) from ai_knowledge) as knowledge,
      (select count(*) from ai_tool_call) as tool_calls
  `);
  console.log('[seed] 完成:', JSON.stringify((counts as unknown as { rows: unknown[] }).rows[0]));
  await handle.close();
}

main().catch((error) => {
  console.error('[seed] 失败:', error);
  process.exit(1);
});
