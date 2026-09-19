export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  db: { driver: 'pglite' | 'postgres'; dataDir: string; url?: string };
  jwt: { secret: string; expiresIn: string };
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    visionModel: string;
    embeddingModel: string;
    embeddingDim: number;
    timeoutMs: number;
  };
  wechat: { appId: string; secret: string };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3100),
  apiPrefix: process.env.API_PREFIX ?? '/api',
  db: {
    driver: (process.env.DB_DRIVER as 'pglite' | 'postgres') ?? 'pglite',
    dataDir: process.env.PGLITE_DATA_DIR ?? '.data/pg',
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'deepseek-chat',
    visionModel: process.env.LLM_VISION_MODEL ?? '',
    embeddingModel: process.env.LLM_EMBEDDING_MODEL ?? '',
    embeddingDim: Number(process.env.LLM_EMBEDDING_DIM ?? 1024),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  },
  wechat: {
    appId: process.env.WX_APPID ?? '',
    secret: process.env.WX_SECRET ?? '',
  },
});

/** 是否配置了大模型 Key —— 决定走真实模型还是 Mock 降级 */
export const hasLlmKey = () => Boolean(process.env.LLM_API_KEY);

/**
 * 生产环境启动前的密钥体检。
 *
 * .env.example 里给的是占位密钥，README 又让大家直接 `cp .env.example .env`，
 * 于是最常见的部署姿势就是「用一个人人皆知的 JWT_SECRET 上线」，任何人都能伪造 token。
 * 这里选择直接拒绝启动，而不是只打一行警告。
 */
export function assertProductionSecrets(
  isProduction: boolean,
  placeholders: string[],
  logger: { error: (message: string) => void },
): void {
  if (!isProduction) return;
  const secret = (process.env.JWT_SECRET ?? '').trim();
  if (placeholders.includes(secret)) {
    logger.error(
      '拒绝启动：生产环境必须设置一个真实的 JWT_SECRET（当前为空或仍是 .env.example 里的占位值）。' +
        '可以用 node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" 生成一个。',
    );
    process.exit(1);
  }
  if (secret.length < 16) {
    logger.error('拒绝启动：JWT_SECRET 太短（至少 16 位），容易被暴力破解。');
    process.exit(1);
  }
}
