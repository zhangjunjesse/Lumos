import {
  ECOMMERCE_ASSISTANT_CHAT_MARKER,
  ECOMMERCE_ASSISTANT_CHAT_TITLE,
  buildEcommerceAssistantChatSystemPrompt,
  isEcommerceAssistantChatSession,
} from '../ecommerce-assistant-session';

describe('ecommerce-assistant-session', () => {
  describe('buildEcommerceAssistantChatSystemPrompt', () => {
    it('includes the marker as the first line', () => {
      const prompt = buildEcommerceAssistantChatSystemPrompt();
      expect(prompt.startsWith(ECOMMERCE_ASSISTANT_CHAT_MARKER)).toBe(true);
    });

    it('mentions all four ecommerce app tabs by name', () => {
      const prompt = buildEcommerceAssistantChatSystemPrompt();
      expect(prompt).toContain('工坊');
      expect(prompt).toContain('任务');
      expect(prompt).toContain('资料库');
      expect(prompt).toContain('预设');
    });

    it('cites concrete in-app button labels so guidance is actionable', () => {
      const prompt = buildEcommerceAssistantChatSystemPrompt();
      expect(prompt).toContain('新建商品输入');
      expect(prompt).toContain('基于此输入出图');
    });

    it('forbids fabricating writes that were not done via tools', () => {
      const prompt = buildEcommerceAssistantChatSystemPrompt();
      expect(prompt).toMatch(/Do not claim/i);
    });

    it('embeds the ecommerce MCP system hint so the model can discover its tools', () => {
      const prompt = buildEcommerceAssistantChatSystemPrompt();
      expect(prompt).toContain('lumos-ecommerce-assistant');
      expect(prompt).toContain('mcp__lumos-ecommerce-assistant__start_image_job');
      expect(prompt).toContain('mcp__lumos-ecommerce-assistant__resolve_product_input');
    });

    it('honors a custom prompt override while still emitting the marker and the MCP hint', () => {
      const prompt = buildEcommerceAssistantChatSystemPrompt('完全自定义提示词');
      expect(prompt).toContain(ECOMMERCE_ASSISTANT_CHAT_MARKER);
      expect(prompt).toContain('完全自定义提示词');
      // Default role/tab text dropped, but the MCP hint stays so tools are still discoverable.
      expect(prompt).not.toContain('## Your role');
      expect(prompt).toContain('lumos-ecommerce-assistant');
    });

    it('falls back to the default prompt when the custom prompt is whitespace only', () => {
      const prompt = buildEcommerceAssistantChatSystemPrompt('   ');
      expect(prompt).toContain('工坊');
    });
  });

  describe('isEcommerceAssistantChatSession', () => {
    it('identifies sessions by the marker in the system prompt', () => {
      expect(
        isEcommerceAssistantChatSession({
          title: 'whatever',
          system_prompt: ECOMMERCE_ASSISTANT_CHAT_MARKER + '\n…',
        }),
      ).toBe(true);
    });

    it('identifies sessions by the canonical title as a fallback', () => {
      expect(
        isEcommerceAssistantChatSession({
          title: ECOMMERCE_ASSISTANT_CHAT_TITLE,
          system_prompt: '',
        }),
      ).toBe(true);
    });

    it('rejects unrelated sessions', () => {
      expect(
        isEcommerceAssistantChatSession({
          title: '资料库 AI 对话',
          system_prompt: '__LUMOS_LIBRARY_CHAT__\n…',
        }),
      ).toBe(false);
    });

    it('rejects null / undefined', () => {
      expect(isEcommerceAssistantChatSession(null)).toBe(false);
      expect(isEcommerceAssistantChatSession(undefined)).toBe(false);
    });
  });
});
