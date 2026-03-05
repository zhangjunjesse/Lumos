const DANGEROUS_PATTERNS = [
  { pattern: /\x00/, reason: 'null byte' },
  { pattern: /\.\.[/\\]/, reason: 'path traversal' },
  { pattern: /\$\(/, reason: 'command substitution' },
];

export function validateInput(text: string): { valid: boolean; reason?: string } {
  if (text.length > 32768) return { valid: false, reason: 'Input too long' };
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) return { valid: false, reason };
  }
  return { valid: true };
}
