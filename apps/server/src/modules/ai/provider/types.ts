/** LLM 抽象层：上层 Agent 只认这个接口，换厂商只改配置 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 请求调用工具时携带 */
  tool_calls?: LlmToolCall[];
  /** role=tool 时对应的调用 id */
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** 已解析的参数（解析失败时为空对象，错误信息在 rawArguments） */
  arguments: Record<string, unknown>;
  rawArguments?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  content: string;
  toolCalls: LlmToolCall[];
  usage: Usage;
  model: string;
  /** 没走真实模型（降级 / Mock）时为 true，前台会标注 */
  degraded: boolean;
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'done'; result: ChatResult };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly isMock: boolean;
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult>;
  chatStream(messages: ChatMessage[], tools: ToolSpec[]): AsyncGenerator<StreamChunk, void, unknown>;
  /** 有 embedding 模型时启用；否则语义检索自动关闭 */
  embed?(texts: string[]): Promise<number[][]>;
}

export const emptyUsage = (): Usage => ({ promptTokens: 0, completionTokens: 0 });
