import { classifyTerminalLlmError, type LlmTerminalErrorClassification } from '@/lib/llm-error-classifier'

const CIRCUIT_GLOBAL_KEY = '__lumosLlmProviderCircuits__'
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000

interface LlmProviderCircuit {
  providerId: string
  providerName?: string
  code: LlmTerminalErrorClassification['code']
  message: string
  openedAt: number
  until: number
}

function getCircuitMap(): Map<string, LlmProviderCircuit> {
  const globalRef = globalThis as Record<string, unknown>
  if (!globalRef[CIRCUIT_GLOBAL_KEY]) {
    globalRef[CIRCUIT_GLOBAL_KEY] = new Map<string, LlmProviderCircuit>()
  }
  return globalRef[CIRCUIT_GLOBAL_KEY] as Map<string, LlmProviderCircuit>
}

function providerLabel(providerId?: string, providerName?: string): string {
  return providerName?.trim() || providerId?.trim() || '当前服务商'
}

export class LlmProviderCircuitOpenError extends Error {
  code = 'llm_provider_circuit_open' as const
  retryable = false as const

  constructor(readonly circuit: LlmProviderCircuit) {
    const seconds = Math.max(1, Math.ceil((circuit.until - Date.now()) / 1000))
    super(
      `服务商“${providerLabel(circuit.providerId, circuit.providerName)}”刚刚返回终止错误：${circuit.message}` +
      `Lumos 已临时停止自动重试，约 ${seconds} 秒后可再次尝试。`,
    )
    this.name = 'LlmProviderCircuitOpenError'
  }
}

export function assertLlmProviderCircuitClosed(providerId?: string, providerName?: string): void {
  const normalizedProviderId = providerId?.trim()
  if (!normalizedProviderId) return

  const circuits = getCircuitMap()
  const circuit = circuits.get(normalizedProviderId)
  if (!circuit) return

  if (circuit.until <= Date.now()) {
    circuits.delete(normalizedProviderId)
    return
  }

  if (!circuit.providerName && providerName?.trim()) {
    circuit.providerName = providerName.trim()
  }
  throw new LlmProviderCircuitOpenError(circuit)
}

export function recordLlmProviderFailure(params: {
  providerId?: string
  providerName?: string
  error: unknown
  cooldownMs?: number
}): LlmTerminalErrorClassification | null {
  const classification = classifyTerminalLlmError(params.error)
  const providerId = params.providerId?.trim()
  if (!classification || !providerId) return classification

  const now = Date.now()
  const cooldownMs = Math.max(30_000, params.cooldownMs ?? DEFAULT_COOLDOWN_MS)
  getCircuitMap().set(providerId, {
    providerId,
    providerName: params.providerName,
    code: classification.code,
    message: classification.userMessage,
    openedAt: now,
    until: now + cooldownMs,
  })
  return classification
}

export function clearLlmProviderCircuit(providerId?: string): void {
  const normalizedProviderId = providerId?.trim()
  if (!normalizedProviderId) return
  getCircuitMap().delete(normalizedProviderId)
}

export function clearAllLlmProviderCircuitsForTest(): void {
  getCircuitMap().clear()
}
