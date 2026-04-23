import type { GraphIndex } from './dsl-validator-graph';
import type { IssueEmit } from './dsl-validator-types';

const DIRECT_CONTEXT_SUMMARY_REF = /^(?:\{\{\s*)?steps\.([A-Za-z][A-Za-z0-9_-]*)\.output\.summary(?:\s*\}\})?$/;
const GUESSED_SHARED_SUMMARY_PATH = /(?:sharedReadDir|_output\.md\b)/;
const ABSOLUTE_PATH_LITERAL = /(["'`])(?:\/tmp\/|\/Users\/|~\/|\/var\/folders\/|[A-Za-z]:\\\\)/;
const PATH_PROPERTY_EXISTS_CHECK = /\b(?:fs\.)?(?:existsSync|statSync|accessSync)\(\s*[^)]*\.path\s*\)/;

function walkStringLeaves(
  value: unknown,
  visit: (text: string, relativePath: string) => void,
  relativePath = '',
): void {
  if (typeof value === 'string') {
    visit(value, relativePath);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStringLeaves(item, visit, `${relativePath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = relativePath ? `${relativePath}.${key}` : `.${key}`;
    walkStringLeaves(nested, visit, nextPath);
  }
}

export function checkStabilityAntiPatterns(index: GraphIndex, emit: IssueEmit): void {
  for (const node of index.nodeById.values()) {
    const input = (node as { input?: unknown }).input;
    if (!input || typeof input !== 'object') continue;

    if ('context' in (input as Record<string, unknown>)) {
      const context = (input as Record<string, unknown>).context;
      if (context && typeof context === 'object' && !Array.isArray(context)) {
        for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
          if (typeof value !== 'string') continue;
          if (DIRECT_CONTEXT_SUMMARY_REF.test(value.trim())) {
            emit({
              severity: 'warning',
              code: 'W_CONTEXT_SUMMARY_REF',
              nodeId: node.id,
              jsonPath: `nodes[${node.id}].input.context.${key}`,
              message: `context field "${key}" references "steps.*.output.summary"; prefer passing the full "steps.*.output" object for more stable downstream contracts`,
              hint: 'Use steps.<upstream>.output unless this node truly needs only the final plain-text summary.',
            });
          }
        }
      }
    }

    walkStringLeaves(input, (text, relativePath) => {
      if (GUESSED_SHARED_SUMMARY_PATH.test(text)) {
        emit({
          severity: 'error',
          code: 'E_SHARED_SUMMARY_FILE_GUESS',
          nodeId: node.id,
          jsonPath: `nodes[${node.id}].input${relativePath}`,
          message: 'workflow DSL must not hardcode or guess runtime-managed shared summary files like *_output.md; consume steps.<id>.output or explicit artifacts instead',
          hint: 'Remove sharedReadDir/_output.md assumptions and pass upstream outputs through context or artifact paths.',
        });
      }
    });

    const code = (input as Record<string, unknown>).code;
    if (!code || typeof code !== 'object') continue;
    const script = (code as { script?: unknown }).script;
    if (typeof script !== 'string' || !script.trim()) continue;

    if (ABSOLUTE_PATH_LITERAL.test(script)) {
      emit({
        severity: 'warning',
        code: 'W_CODE_ABSOLUTE_PATH_LITERAL',
        nodeId: node.id,
        jsonPath: `nodes[${node.id}].input.code.script`,
        message: 'code script contains an absolute filesystem path literal; generated workflow code should write outputs via ctx.outputDir / ctx.saveArtifact instead',
        hint: 'Map any hardcoded /tmp, /Users, ~ or drive-letter paths into ctx.outputDir subdirectories.',
      });
    }

    if (PATH_PROPERTY_EXISTS_CHECK.test(script)) {
      emit({
        severity: 'warning',
        code: 'W_CODE_RELATIVE_PATH_CHECK',
        nodeId: node.id,
        jsonPath: `nodes[${node.id}].input.code.script`,
        message: 'code script checks *.path directly with existsSync/statSync; workflow-generated paths are often relative and should be resolved against known output directories first',
        hint: 'Resolve upstream relative paths via ctx.outputDir / run stage output directories before fs existence checks.',
      });
    }
  }
}
