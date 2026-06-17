export interface AutoContinueDirective {
  continue: boolean;
  delaySeconds?: number;
  summary?: string;
}

const AUTO_CONTINUE_RE = /<!--\s*lumos:auto-continue\s+({[\s\S]*?})\s*-->/i;

export function parseAutoContinueDirective(content: string): AutoContinueDirective | null {
  const match = content.match(AUTO_CONTINUE_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    if (typeof parsed.continue !== 'boolean') return null;
    return {
      continue: parsed.continue,
      delaySeconds: typeof parsed.delaySeconds === 'number' ? parsed.delaySeconds : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function stripAutoContinueDirective(content: string): string {
  return content.replace(AUTO_CONTINUE_RE, '').trim();
}

export const AUTO_CONTINUE_SYSTEM_HINT = `
This Lumos chat session supports single-agent auto-continue.
If the user's current goal requires you to continue this SAME conversation later, end your response with exactly one hidden control comment:
<!-- lumos:auto-continue {"continue":true,"delaySeconds":60,"summary":"short status"} -->
If the work is complete or should not continue, end with:
<!-- lumos:auto-continue {"continue":false,"summary":"short status"} -->
Use delaySeconds between 30 and 3600. Do not show this control comment as user-facing text.
`.trim();
