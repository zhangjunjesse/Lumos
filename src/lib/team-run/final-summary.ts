import type { FinalSummaryPayloadV1, FinalSummaryResultV1 } from './runtime-contracts'

function normalizeText(value: string): string {
  return value.trim()
}

function truncateLine(value: string, maxLength: number = 160): string {
  const normalized = normalizeText(value)
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

export function createFinalSummaryResult(payload: FinalSummaryPayloadV1): FinalSummaryResultV1 {
  const completedStages = payload.stageResults.filter((stage) => stage.status === 'done' && normalizeText(stage.summary))
  const completedSections = completedStages.map((stage) => `## ${stage.title}\n${normalizeText(stage.summary)}`)
  const keyOutputs = completedStages
    .map((stage) => `${stage.title}: ${truncateLine(stage.summary)}`)
    .slice(0, 5)

  const sections = [
    '# Final Summary',
    ...(normalizeText(payload.userGoal) ? [`Goal: ${normalizeText(payload.userGoal)}`] : []),
    ...(normalizeText(payload.expectedOutcome) ? [`Expected Outcome: ${normalizeText(payload.expectedOutcome)}`] : []),
    ...(normalizeText(payload.runSummary) ? [`## Run Overview\n${normalizeText(payload.runSummary)}`] : []),
    ...(keyOutputs.length > 0 ? [`## Key Outputs\n${keyOutputs.map((item) => `- ${item}`).join('\n')}`] : []),
    ...(completedSections.length > 0 ? completedSections : []),
  ]

  const finalSummary = sections.join('\n\n').trim()

  return {
    contractVersion: 'final-summary-result/v1',
    runId: payload.runId,
    finalSummary,
    keyOutputs,
    publishableMessage: finalSummary,
  }
}
