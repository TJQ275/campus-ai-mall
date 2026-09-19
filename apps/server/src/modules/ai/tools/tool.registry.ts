import { Injectable } from '@nestjs/common';
import { CatalogTools } from './catalog.tools.js';
import { TradeTools } from './trade.tools.js';
import { KnowledgeTools } from './knowledge.tools.js';
import { MediaTools } from './media.tools.js';
import { zodToJsonSchema, type AiTool, type AiContext } from './tool.types.js';
import type { ToolSpec } from '../provider/types.js';

/** 工具注册表：新增能力只要写一个 AiTool 并注册进来，Agent 与文档自动生效 */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, AiTool>();

  constructor(catalogTools: CatalogTools, tradeTools: TradeTools, knowledgeTools: KnowledgeTools, mediaTools: MediaTools) {
    for (const tool of [...catalogTools.all(), ...tradeTools.all(), ...knowledgeTools.all(), ...mediaTools.all()]) {
      this.register(tool);
    }
  }

  register(tool: AiTool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AiTool | undefined {
    return this.tools.get(name);
  }

  list(): AiTool[] {
    return [...this.tools.values()];
  }

  /** 按场景过滤出暴露给模型的工具定义 */
  specs(scene: AiContext['scene']): ToolSpec[] {
    return this.list()
      .filter((t) => !t.scenes || t.scenes.includes(scene))
      .map((t) => ({ name: t.name, description: t.description, parameters: zodToJsonSchema(t.schema) }));
  }
}