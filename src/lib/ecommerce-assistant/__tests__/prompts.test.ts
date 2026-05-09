import {
  BRIEF_IDENTIFY_PROMPT,
  CUTOUT_FALLBACK_HINT,
  CUTOUT_PROMPT,
  CUTOUT_QC_PROMPT,
  FALLBACK_PROMPT,
  FINAL_QC_PROMPT,
  SYSTEM_PROMPT,
  buildFinalRefinePrompt,
  buildPlanDirectionsPrompt,
  buildSceneGenerationPrompt,
  buildScoringPrompt,
} from '../prompts';
import type { DirectionPlan, ProductBrief, ScoreReport } from '../types';

const SAMPLE_BRIEF: ProductBrief = {
  productType: 'wooden coffee table',
  categoryBucket: 'furniture',
  sizeClass: 'large',
  channelGoal: 'marketplace_hero',
  coreSellingPoints: ['solid oak', 'minimalist'],
  targetAudience: ['urban renter', 'design-conscious'],
  recommendedUsageScenes: ['living room'],
  recommendedPlacement: ['next to sofa'],
  recommendedSurfaceType: 'living room rug',
  recommendedShotType: 'room_scene',
  recommendedLighting: 'soft natural daylight',
  recommendedCameraAngle: '45-degree front angle',
  recommendedLensStyle: '35mm interior commercial photography look',
  recommendedDepthOfField: 'moderate',
  recommendedShadowStyle: 'soft_natural',
  recommendedColorTemperature: 'neutral',
  recommendedAspectRatio: '4:5',
  recommendedSceneComplexity: 'minimal',
  occlusionTolerance: 'none',
  humanPresencePolicy: 'forbidden',
  petPresencePolicy: 'forbidden',
  styleDirection: ['nordic'],
  avoidElements: ['busy patterns'],
  fidelityFocus: ['top wood grain'],
  consistencyAnchors: ['wood grain', 'leg shape', 'edge bevel'],
  confidence: 8,
};

describe('ecommerce-assistant prompts', () => {
  it('SYSTEM_PROMPT requires strict JSON', () => {
    expect(SYSTEM_PROMPT).toContain('严格');
    expect(SYSTEM_PROMPT).toContain('JSON');
  });

  it('BRIEF_IDENTIFY_PROMPT enumerates all default rules', () => {
    expect(BRIEF_IDENTIFY_PROMPT).toContain('aspectRatio');
    expect(BRIEF_IDENTIFY_PROMPT).toContain('humanPresencePolicy');
    expect(BRIEF_IDENTIFY_PROMPT).toContain('consistencyAnchors');
  });

  it('buildPlanDirectionsPrompt includes brief JSON', () => {
    const out = buildPlanDirectionsPrompt(SAMPLE_BRIEF);
    expect(out).toContain('catalog');
    expect(out).toContain('lifestyle');
    expect(out).toContain('campaign');
    expect(out).toContain(JSON.stringify(SAMPLE_BRIEF));
  });

  it('buildSceneGenerationPrompt embeds direction and photography controls', () => {
    const direction: DirectionPlan = {
      id: 'lifestyle',
      scene: 'cozy living room',
      composition: 'centered hero',
      lighting: 'warm sunlight',
      mood: 'inviting',
      negativeRules: ['no clutter'],
    };
    const out = buildSceneGenerationPrompt({
      brief: SAMPLE_BRIEF,
      direction,
      fallback: false,
    });
    expect(out).toContain(direction.scene);
    expect(out).toContain(direction.composition);
    expect(out).toContain(direction.lighting);
    expect(out).toContain('Aspect ratio: 4:5');
    expect(out).toContain('Shot type: room_scene');
    expect(out).not.toContain('Fallback mode');
  });

  it('buildSceneGenerationPrompt appends fallback block when requested', () => {
    const direction: DirectionPlan = {
      id: 'catalog',
      scene: 'clean studio',
      composition: 'centered',
      lighting: 'soft fill',
      mood: 'clean',
      negativeRules: [],
    };
    const out = buildSceneGenerationPrompt({ brief: SAMPLE_BRIEF, direction, fallback: true });
    expect(out).toContain('Fallback mode');
    expect(out).toContain('Prioritize product fidelity');
  });

  it('CUTOUT_PROMPT and CUTOUT_FALLBACK_HINT are well-formed', () => {
    expect(CUTOUT_PROMPT).toContain('Image 1');
    expect(CUTOUT_PROMPT).toContain('isolate the product');
    expect(CUTOUT_FALLBACK_HINT).toContain('Fallback mode');
  });

  it('CUTOUT_QC_PROMPT and FINAL_QC_PROMPT mention required check fields', () => {
    expect(CUTOUT_QC_PROMPT).toContain('structure');
    expect(CUTOUT_QC_PROMPT).toContain('material');
    expect(CUTOUT_QC_PROMPT).toContain('edgeQuality');
    expect(FINAL_QC_PROMPT).toContain('proportion');
    expect(FINAL_QC_PROMPT).toContain('grounding');
    expect(FINAL_QC_PROMPT).toContain('retryStage');
  });

  it('buildScoringPrompt embeds brief and explicit nextAction rules', () => {
    const out = buildScoringPrompt(SAMPLE_BRIEF);
    expect(out).toContain('catalog / lifestyle / campaign');
    expect(out).toContain('rerun_scene_generation');
    expect(out).toContain(JSON.stringify(SAMPLE_BRIEF));
  });

  it('buildFinalRefinePrompt highlights weak areas from score report', () => {
    const report: ScoreReport = {
      scores: [
        {
          id: 'lifestyle',
          productFidelity: 9,
          structureAccuracy: 9,
          detailConsistency: 7,
          sceneSuitability: 8,
          compositionQuality: 7,
          photographicRealism: 6,
          groundingRealism: 6,
          total: 52,
          hardFail: false,
          hardFailReason: null,
        },
        {
          id: 'catalog',
          productFidelity: 8,
          structureAccuracy: 8,
          detailConsistency: 8,
          sceneSuitability: 7,
          compositionQuality: 7,
          photographicRealism: 7,
          groundingRealism: 7,
          total: 52,
          hardFail: false,
          hardFailReason: null,
        },
        {
          id: 'campaign',
          productFidelity: 7,
          structureAccuracy: 7,
          detailConsistency: 7,
          sceneSuitability: 7,
          compositionQuality: 7,
          photographicRealism: 7,
          groundingRealism: 7,
          total: 49,
          hardFail: false,
          hardFailReason: null,
        },
      ],
      winnerId: 'lifestyle',
      winnerReason: 'best fidelity',
      nextAction: 'final_refine',
      needsRerun: false,
    };
    const out = buildFinalRefinePrompt({ brief: SAMPLE_BRIEF, scoreReport: report });
    expect(out).toContain('photographic realism');
    expect(out).toContain('grounding realism');
    expect(out).toContain('detail consistency');
    expect(out).toContain('composition quality');
  });

  it('buildFinalRefinePrompt without score report falls back gracefully', () => {
    const out = buildFinalRefinePrompt({ brief: SAMPLE_BRIEF });
    expect(out).toContain('保持商品本体不变');
  });

  it('FALLBACK_PROMPT requires white background and no environment', () => {
    expect(FALLBACK_PROMPT).toContain('Pure white background');
    expect(FALLBACK_PROMPT).toContain('no environment');
  });
});
