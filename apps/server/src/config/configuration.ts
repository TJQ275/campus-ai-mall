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
