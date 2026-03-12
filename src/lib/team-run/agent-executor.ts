import type { TeamPlanRole, TeamRunStage, TeamPlan } from '@/types';
import { createClaudeClient } from '@/lib/claude-client';

export interface PhaseContext {
  phase: TeamRunStage;
  role: TeamPlanRole;
  plan: TeamPlan;
  dependencyResults: Array<{ title: string; result: string }>;
  sessionId: string;
  workingDirectory: string;
}

export interface PhaseResult {
  success: boolean;
  result: string;
  error?: string;
}

/**
 * Agent 执行引擎
 * 负责为每个 TeamRunStage 创建独立的 agent 实例并执行
 */
export class AgentExecutor {
  /**
   * 执行单个 phase
   */
  async executePhase(context: PhaseContext): Promise<PhaseResult> {
    try {
      // 1. 构建 system prompt
      const systemPrompt = this.buildSystemPrompt(context);

      // 2. 构建用户消息
      const userMessage = this.buildUserMessage(context);

      // 3. 创建 Claude client
      const client = await createClaudeClient({
        workingDirectory: context.workingDirectory,
        systemPrompt,
      });

      // 4. 执行 agent
      const response = await client.sendMessage(userMessage);

      // 5. 提取结果
      const result = this.extractResult(response);

      return {
        success: true,
        result,
      };
    } catch (error) {
      return {
        success: false,
        result: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 构建 system prompt
   */
  private buildSystemPrompt(context: PhaseContext): string {
    const { role, plan } = context;

    return `你是 ${role.name}，负责：${role.responsibility}

# 团队协作背景
${plan.summary}

# 你的角色
- 角色类型：${role.kind}
- 职责：${role.responsibility}

# 工作要求
1. 专注于你的职责范围
2. 基于上游依赖的输出完成你的任务
3. 输出清晰、可执行的结果
4. 如果遇到问题，明确说明

# 输出格式
请按以下格式输出：

## 执行结果
[你的工作成果]

## 关键发现
[重要发现或问题]

## 下游建议
[给下游角色的建议]`;
  }

  /**
   * 构建用户消息
   */
  private buildUserMessage(context: PhaseContext): string {
    const { phase, dependencyResults } = context;

    let message = `# 任务：${phase.title}\n\n`;

    // 添加依赖结果
    if (dependencyResults.length > 0) {
      message += `## 上游输入\n\n`;
      for (const dep of dependencyResults) {
        message += `### ${dep.title}\n${dep.result}\n\n`;
      }
    }

    // 添加期望输出
    message += `## 期望输出\n${phase.expectedOutput}\n\n`;
    message += `请开始执行你的任务。`;

    return message;
  }

  /**
   * 从响应中提取结果
   */
  private extractResult(response: string): string {
    // 简单提取，后续可以优化
    return response.trim();
  }
}
