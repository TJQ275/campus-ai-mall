import { Logger } from '@nestjs/common';
import {
  emptyUsage, type ChatMessage, type ChatResult, type LlmProvider, type LlmToolCall, type StreamChunk, type ToolSpec,
} from './types.js';

interface ProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel?: string;
  timeoutMs?: number;
}

interface OpenAiDelta {
  content?: string | null;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

/**
 * 任意 OpenAI 兼容接口（DeepSeek / 通义 / Kimi / 智谱 / OpenRouter / Ollama / vLLM）。
 * 工具调用与流式都按 OpenAI 的协议实现，因此换厂商只需要改 LLM_BASE_URL 与 LLM_MODEL。
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';
  readonly model: string;
  readonly isMock = false;
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);

  constructor(private readonly options: ProviderOptions) {
    this.model = options.model;
  }

  private headers() {
    return {
      'content-type': 'application/json',
      authorization: 'Bearer ' + this.options.apiKey,
    };
  }

  private body(messages: ChatMessage[], tools: ToolSpec[], stream: boolean) {
    const payload: Record<string, unknown> = {
      model: this.options.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.rawArguments ?? JSON.stringify(c.arguments) } })) } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
            tool_choice: 'auto',
          }
        : {}),
    };
    return payload;
  }

  /**
   * 发起请求。
   *
   * 超时用「读体超时」而不是「连接超时」：早期实现在 finally 里 clearTimeout，
   * 只保护到拿到响应头 —— 流式响应一旦开始吐字，读取过程就没有任何超时保护，
   * 上游卡住会永久挂住这个连接并一直占着用户的对话。
   * 这里把 signal 一路带到 chatStream 的读循环，由调用方在读完（或断开）时收尾。
   */
  private async request(
    messages: ChatMessage[],
    tools: ToolSpec[],
    stream: boolean,
    signal?: AbortSignal,
  ): Promise<{ response: Response; finish: () => void }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60000);
    const finish = () => clearTimeout(timer);
    // 外部 signal（客户端断开）与内部超时，任意一个触发都中止请求
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    try {
      const response = await fetch(this.options.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(messages, tools, stream)),
        signal: combined,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        finish();
        throw new Error('模型接口返回 ' + response.status + ': ' + text.slice(0, 300));
      }
      return { response, finish };
    } catch (error) {
      finish();
      throw error;
    }
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatResult> {
    const { response, finish } = await this.request(messages, tools, false, signal);
    const json = await response.json().finally(finish) as {
      choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const message = json.choices?.[0]?.message;
    const toolCalls: LlmToolCall[] = (message?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: safeParse(c.function.arguments),
      rawArguments: c.function.arguments,
    }));
    return {
      content: message?.content ?? '',
      toolCalls,
      usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0 },
      model: json.model ?? this.model,
      degraded: false,
    };
  }

  async *chatStream(messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
    // 流式请求的超时由 request() 里的 timer 控制，直到这里读完才 clear（finish）
    const { response, finish } = await this.request(messages, tools, true, signal);
    if (!response.body) {
      finish();
      throw new Error('模型接口没有返回流式响应');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const usage = emptyUsage();
    const partial = new Map<number, { id?: string; name?: string; args: string }>();
    let model = this.model;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let parsed: { choices?: { delta?: OpenAiDelta }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
          try { parsed = JSON.parse(payload); } catch { continue; }
          if (parsed.model) model = parsed.model;
          if (parsed.usage) {
            usage.promptTokens = parsed.usage.prompt_tokens ?? usage.promptTokens;
            usage.completionTokens = parsed.usage.completion_tokens ?? usage.completionTokens;
          }
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            content += delta.content;
            yield { type: 'text', delta: delta.content };
          }
          for (const call of delta.tool_calls ?? []) {
            const current = partial.get(call.index) ?? { args: '' };
            if (call.id) current.id = call.id;
            if (call.function?.name) current.name = call.function.name;
            if (call.function?.arguments) current.args += call.function.arguments;
            partial.set(call.index, current);
          }
        }
      }
    } finally {
      finish();
      // 主动断开底层的读流，避免连接被挂住
      await reader.cancel().catch(() => undefined);
    }

    const toolCalls: LlmToolCall[] = [...partial.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, value]) => ({
        id: value.id ?? 'call_' + index,
        name: value.name ?? 'unknown',
        arguments: safeParse(value.args),
        rawArguments: value.args,
      }))
      .filter((c) => c.name !== 'unknown');

    yield { type: 'done', result: { content, toolCalls, usage, model, degraded: false } };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.options.embeddingModel) throw new Error('未配置 LLM_EMBEDDING_MODEL，无法生成向量');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60000);
    try {
      const response = await fetch(this.options.baseUrl.replace(/\/+$/, '') + '/embeddings', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: this.options.embeddingModel, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('embedding 接口返回 ' + response.status);
      const json = (await response.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function safeParse(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
