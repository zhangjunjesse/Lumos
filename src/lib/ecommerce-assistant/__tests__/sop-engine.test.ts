import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { runSop } from '../sop-engine';
import { createJobRecord, ensureBuiltinStylePresets } from '../storage';
import type {
  ImageOutputRecord,
  ProductBrief,
  ProductInputRecord,
} from '../types';

jest.mock('@/lib/image', () => ({
  generateImages: jest.fn(),
}));

jest.mock('../llm-client', () => ({
  EcommerceLlmUnavailableError: class extends Error {},
  identifyProductBrief: jest.fn(),
  planDirections: jest.fn(),
  evaluateCutout: jest.fn(),
  scoreScenes: jest.fn(),
  evaluateFinal: jest.fn(),
}));

const APP_ID = 'ecommerce-assistant';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(APP_ID, APP_ID, '0.1.0', '{}', 'builtin', '/tmp/' + APP_ID, Date.now());
  return db;
}

function buildBrief(): ProductBrief {
  return {
    productType: 'wooden table',
    categoryBucket: 'furniture',
    sizeClass: 'medium',
    channelGoal: 'marketplace_hero',
    coreSellingPoints: ['solid oak'],
    targetAudience: ['renter'],
    recommendedUsageScenes: ['living room'],
    recommendedPlacement: ['next to sofa'],
    recommendedSurfaceType: 'rug',
    recommendedShotType: 'tabletop',
    recommendedLighting: 'soft daylight',
    recommendedCameraAngle: '45-degree',
    recommendedLensStyle: '50mm',
    recommendedDepthOfField: 'moderate',
    recommendedShadowStyle: 'soft_natural',
    recommendedColorTemperature: 'neutral',
    recommendedAspectRatio: '4:5',
    recommendedSceneComplexity: 'minimal',
    occlusionTolerance: 'none',
    humanPresencePolicy: 'forbidden',
    petPresencePolicy: 'forbidden',
    styleDirection: ['nordic'],
    avoidElements: [],
    fidelityFocus: ['wood grain'],
    consistencyAnchors: ['wood grain'],
    confidence: 9,
  };
}

interface MockedLlmModule {
  identifyProductBrief: jest.Mock;
  planDirections: jest.Mock;
  evaluateCutout: jest.Mock;
  scoreScenes: jest.Mock;
  evaluateFinal: jest.Mock;
}

interface MockedImageModule {
  generateImages: jest.Mock;
}

const llm = jest.requireMock('../llm-client') as MockedLlmModule;
const imageMod = jest.requireMock('@/lib/image') as MockedImageModule;

beforeEach(() => {
  jest.resetAllMocks();
});

function seedJob(db: Database.Database) {
  const store = createAppDataStore(db, APP_ID);
  ensureBuiltinStylePresets(store);
  const input = store.create<ProductInputRecord>('product_inputs', {
    title: '木桌',
    main_image_path: '/tmp/main.png',
    reference_image_paths: JSON.stringify(['/tmp/ref1.png', '/tmp/ref2.png']),
    status: 'ready',
  });
  const job = createJobRecord(store, { input_id: input.id });
  return { store, input, job };
}

describe('runSop', () => {
  it('happy path: brief → cutout → 3 directions → score → refine pass', async () => {
    const db = setupDb();
    const { store, input, job } = seedJob(db);

    llm.identifyProductBrief.mockResolvedValue(buildBrief());
    llm.planDirections.mockResolvedValue([
      { id: 'catalog', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
      { id: 'lifestyle', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
      { id: 'campaign', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
    ]);
    llm.evaluateCutout.mockResolvedValue({
      pass: true,
      checks: {
        structure: 'pass',
        material: 'pass',
        edgeQuality: 'pass',
        completeness: 'pass',
        backgroundCleanliness: 'pass',
      },
      failReason: null,
      retry: false,
    });
    llm.scoreScenes.mockResolvedValue({
      scores: [
        { id: 'catalog', productFidelity: 9, structureAccuracy: 9, detailConsistency: 9, sceneSuitability: 8, compositionQuality: 8, photographicRealism: 8, groundingRealism: 8, total: 59, hardFail: false, hardFailReason: null },
        { id: 'lifestyle', productFidelity: 8, structureAccuracy: 8, detailConsistency: 8, sceneSuitability: 8, compositionQuality: 8, photographicRealism: 8, groundingRealism: 8, total: 56, hardFail: false, hardFailReason: null },
        { id: 'campaign', productFidelity: 7, structureAccuracy: 7, detailConsistency: 7, sceneSuitability: 7, compositionQuality: 7, photographicRealism: 7, groundingRealism: 7, total: 49, hardFail: false, hardFailReason: null },
      ],
      winnerId: 'catalog',
      winnerReason: 'best fidelity',
      nextAction: 'final_refine',
      needsRerun: false,
    });
    llm.evaluateFinal.mockResolvedValue({
      pass: true,
      checks: {
        structure: 'pass', proportion: 'pass', material: 'pass', details: 'pass', color: 'pass',
        shadow: 'pass', grounding: 'pass', photographicRealism: 'pass',
        backgroundCleanliness: 'pass', extraObjects: 'pass', textOrWatermark: 'pass',
      },
      failReason: null,
      retryStage: 'none',
    });

    let counter = 0;
    imageMod.generateImages.mockImplementation(async () => {
      counter += 1;
      return {
        images: [{ localPath: `/tmp/gen-${counter}.png`, mimeType: 'image/png' }],
      };
    });

    const result = await runSop({ jobId: job.id, store });
    expect(result.status).toBe('completed');
    expect(result.final_image_path).toMatch(/gen-/);
    expect(result.winner_direction).toBe('catalog');
    expect(result.fallback_used).toBeFalsy();
    const outputs = store.query<ImageOutputRecord>('image_outputs', { filter: { job_id: job.id }, limit: 200 });
    expect(outputs.some((o) => o.kind === 'cutout' && o.qc_pass)).toBe(true);
    expect(outputs.some((o) => o.kind === 'final' && o.is_winner)).toBe(true);
    expect(input.id).toBeTruthy();
    db.close();
  });

  it('cutout failed twice → marks job failed without scene generation', async () => {
    const db = setupDb();
    const { store, job } = seedJob(db);

    llm.identifyProductBrief.mockResolvedValue(buildBrief());
    llm.evaluateCutout.mockResolvedValue({
      pass: false,
      checks: {
        structure: 'fail', material: 'pass', edgeQuality: 'pass', completeness: 'pass', backgroundCleanliness: 'pass',
      },
      failReason: '商品轮廓被截断',
      retry: true,
    });
    imageMod.generateImages.mockImplementation(async () => ({
      images: [{ localPath: '/tmp/cutout.png', mimeType: 'image/png' }],
    }));

    const result = await runSop({ jobId: job.id, store });
    expect(result.status).toBe('failed');
    expect(result.failure_stage).toBe('cutting');
    expect(result.cutout_attempts).toBe(2);
    expect(llm.planDirections).not.toHaveBeenCalled();
    expect(llm.scoreScenes).not.toHaveBeenCalled();
    db.close();
  });

  it('final QC failed twice + scene rerun exhausted → falls back to white-background', async () => {
    const db = setupDb();
    const { store, job } = seedJob(db);

    llm.identifyProductBrief.mockResolvedValue(buildBrief());
    llm.evaluateCutout.mockResolvedValue({
      pass: true,
      checks: { structure: 'pass', material: 'pass', edgeQuality: 'pass', completeness: 'pass', backgroundCleanliness: 'pass' },
      failReason: null,
      retry: false,
    });
    llm.planDirections.mockResolvedValue([
      { id: 'catalog', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
      { id: 'lifestyle', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
      { id: 'campaign', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
    ]);
    llm.scoreScenes.mockResolvedValue({
      scores: [
        { id: 'catalog', productFidelity: 9, structureAccuracy: 9, detailConsistency: 9, sceneSuitability: 8, compositionQuality: 8, photographicRealism: 8, groundingRealism: 8, total: 59, hardFail: false, hardFailReason: null },
        { id: 'lifestyle', productFidelity: 8, structureAccuracy: 8, detailConsistency: 8, sceneSuitability: 8, compositionQuality: 8, photographicRealism: 8, groundingRealism: 8, total: 56, hardFail: false, hardFailReason: null },
        { id: 'campaign', productFidelity: 7, structureAccuracy: 7, detailConsistency: 7, sceneSuitability: 7, compositionQuality: 7, photographicRealism: 7, groundingRealism: 7, total: 49, hardFail: false, hardFailReason: null },
      ],
      winnerId: 'catalog',
      winnerReason: 'best fidelity',
      nextAction: 'final_refine',
      needsRerun: false,
    });
    // Final QC always fails with retryStage=final_refine, exhausting the inner refine loop.
    llm.evaluateFinal.mockResolvedValue({
      pass: false,
      checks: { structure: 'pass', proportion: 'pass', material: 'pass', details: 'pass', color: 'fail', shadow: 'fail', grounding: 'fail', photographicRealism: 'fail', backgroundCleanliness: 'pass', extraObjects: 'pass', textOrWatermark: 'pass' },
      failReason: '阴影不可信',
      retryStage: 'final_refine',
    });

    let counter = 0;
    imageMod.generateImages.mockImplementation(async () => {
      counter += 1;
      return { images: [{ localPath: `/tmp/img-${counter}.png`, mimeType: 'image/png' }] };
    });

    const result = await runSop({ jobId: job.id, store });
    expect(result.status).toBe('completed');
    expect(result.fallback_used).toBe(true);
    expect(result.summary).toContain('白底');
    db.close();
  });

  it('cancellation via abortSignal marks job cancelled', async () => {
    const db = setupDb();
    const { store, job } = seedJob(db);

    const ctrl = new AbortController();
    llm.identifyProductBrief.mockImplementation(async () => {
      ctrl.abort();
      return buildBrief();
    });
    llm.planDirections.mockResolvedValue([]);
    imageMod.generateImages.mockResolvedValue({ images: [{ localPath: '/tmp/x.png', mimeType: 'image/png' }] });

    const result = await runSop({ jobId: job.id, store, abortSignal: ctrl.signal });
    expect(['cancelled', 'failed']).toContain(result.status);
    if (result.status === 'cancelled') {
      expect(result.failure_reason).toContain('取消');
    }
    db.close();
  });

  it('tolerates partial direction failures: 1 direction errors, 2 succeed → still scores winner', async () => {
    const db = setupDb();
    const { store, job } = seedJob(db);

    llm.identifyProductBrief.mockResolvedValue(buildBrief());
    llm.evaluateCutout.mockResolvedValue({
      pass: true,
      checks: { structure: 'pass', material: 'pass', edgeQuality: 'pass', completeness: 'pass', backgroundCleanliness: 'pass' },
      failReason: null,
      retry: false,
    });
    llm.planDirections.mockResolvedValue([
      { id: 'catalog', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
      { id: 'lifestyle', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
      { id: 'campaign', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
    ]);
    llm.scoreScenes.mockResolvedValue({
      scores: [
        { id: 'catalog', productFidelity: 9, structureAccuracy: 9, detailConsistency: 9, sceneSuitability: 8, compositionQuality: 8, photographicRealism: 8, groundingRealism: 8, total: 59, hardFail: false, hardFailReason: null },
        { id: 'lifestyle', productFidelity: 8, structureAccuracy: 8, detailConsistency: 8, sceneSuitability: 8, compositionQuality: 8, photographicRealism: 8, groundingRealism: 8, total: 56, hardFail: false, hardFailReason: null },
        { id: 'campaign', productFidelity: 7, structureAccuracy: 7, detailConsistency: 7, sceneSuitability: 7, compositionQuality: 7, photographicRealism: 7, groundingRealism: 7, total: 49, hardFail: false, hardFailReason: null },
      ],
      winnerId: 'catalog',
      winnerReason: 'best',
      nextAction: 'final_refine',
      needsRerun: false,
    });
    llm.evaluateFinal.mockResolvedValue({
      pass: true,
      checks: { structure: 'pass', proportion: 'pass', material: 'pass', details: 'pass', color: 'pass', shadow: 'pass', grounding: 'pass', photographicRealism: 'pass', backgroundCleanliness: 'pass', extraObjects: 'pass', textOrWatermark: 'pass' },
      failReason: null,
      retryStage: 'none',
    });

    let counter = 0;
    imageMod.generateImages.mockImplementation(async (params: { prompt?: string }) => {
      counter += 1;
      // Fail every call where prompt mentions lifestyle scene
      if (params.prompt?.includes('lifestyle')) {
        throw new Error('lifestyle direction provider failed');
      }
      return { images: [{ localPath: `/tmp/gen-${counter}.png`, mimeType: 'image/png' }] };
    });

    const result = await runSop({ jobId: job.id, store });
    expect(result.status).toBe('completed');
    expect(result.winner_direction).toBe('catalog');
    db.close();
  });

  it('all three directions fail and exhaust retries → falls back to white-bg', async () => {
    const db = setupDb();
    const { store, job } = seedJob(db);

    llm.identifyProductBrief.mockResolvedValue(buildBrief());
    llm.evaluateCutout.mockResolvedValue({
      pass: true,
      checks: { structure: 'pass', material: 'pass', edgeQuality: 'pass', completeness: 'pass', backgroundCleanliness: 'pass' },
      failReason: null,
      retry: false,
    });
    llm.planDirections.mockResolvedValue([
      { id: 'catalog', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
      { id: 'lifestyle', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
      { id: 'campaign', scene: 's', composition: 'c', lighting: 'l', mood: 'm', negativeRules: [] },
    ]);

    let calls = 0;
    imageMod.generateImages.mockImplementation(async (params: { prompt?: string }) => {
      calls += 1;
      // Fail all scene direction calls (3 dirs * 3 attempts = 9), succeed on cutout and fallback.
      if (params.prompt?.includes('e-commerce scene')) {
        throw new Error('all directions fail this attempt');
      }
      return { images: [{ localPath: `/tmp/img-${calls}.png`, mimeType: 'image/png' }] };
    });

    const result = await runSop({ jobId: job.id, store });
    expect(result.status).toBe('completed');
    expect(result.fallback_used).toBe(true);
    expect(llm.scoreScenes).not.toHaveBeenCalled();
    db.close();
  });

  it('respects cancelled status set before runner starts (no work done)', async () => {
    const db = setupDb();
    const { store, job } = seedJob(db);
    // Manually mark cancelled (mirrors the cancel API marking a queued job).
    store.update('image_jobs', job.id, {
      status: 'cancelled',
      stage: 'cancelled',
      failure_reason: '任务被用户取消',
    });
    const result = await runSop({ jobId: job.id, store });
    expect(result.status).toBe('cancelled');
    expect(llm.identifyProductBrief).not.toHaveBeenCalled();
    expect(imageMod.generateImages).not.toHaveBeenCalled();
    db.close();
  });

  it('marks job failed when product input is missing', async () => {
    const db = setupDb();
    const store = createAppDataStore(db, APP_ID);
    const inputRow = store.create<ProductInputRecord>('product_inputs', {
      title: '木桌',
      main_image_path: '/tmp/main.png',
      status: 'ready',
    });
    const job = createJobRecord(store, { input_id: inputRow.id });
    store.delete('product_inputs', inputRow.id);
    const result = await runSop({ jobId: job.id, store });
    expect(result.status).toBe('failed');
    expect(result.failure_stage).toBe('preprocessing');
    expect(result.failure_reason).toContain('not found');
    db.close();
  });
});
