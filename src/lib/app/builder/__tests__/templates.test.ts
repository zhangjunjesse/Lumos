import { validateAppTool } from '../tools/validate-app';
import {
  APP_BUILDER_TEMPLATES,
  buildTemplateBlueprintFiles,
} from '../templates';
import type { BuilderSession } from '../session';

describe('app builder templates', () => {
  it.each(APP_BUILDER_TEMPLATES)('builds a valid starter package for $id', async (template) => {
    const session: BuilderSession = {
      id: `bs_${template.id.replace(/-/g, '')}123456`,
      status: 'gathering',
      appName: template.name,
      appDescription: template.description,
      templateId: template.id,
      createdAt: 0,
      updatedAt: 0,
    };

    const files = buildTemplateBlueprintFiles(session, template.id, { now: 1714470000000 });

    expect(files).toBeTruthy();
    expect(Object.keys(files ?? {}).sort()).toEqual([
      'app.json',
      'data-schema.json',
      expect.stringMatching(/^pages\/.+\.json$/),
      expect.stringMatching(/^pages\/.+\.json$/),
      'routes.json',
    ]);

    const result = await validateAppTool.execute(
      { files: files ?? {} },
      { sessionId: session.id },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.errorCount).toBe(0);
    }
  });
});
