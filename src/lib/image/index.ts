/**
 * Image generation module — public API.
 *
 * Architecture: Strategy + Registry + Adapter
 * - types.ts     — interfaces, error classes
 * - registry.ts  — provider factory registry (globalThis singleton)
 * - generate.ts  — orchestration (resolve → generate → persist)
 * - persist.ts   — disk save, DB record, session copy
 * - providers/*  — per-provider adapters
 */

// Core types — re-export only what external consumers need
export type {
  ImageCapability,
  ImageInput,
  ImageSize,
  ImageGenRequest,
  ImageGenResult,
  ImageGenErrorCode,
  ImageProvider,
  ImageProviderConfig,
  ImageProviderFactory,
} from './types'
export { ImageGenError } from './types'

// Registry — for custom provider registration
export { registerImageProvider } from './registry'

// Orchestrator — main entry point
export { generateImages } from './generate'
export type { GenerateImagesParams, GenerateImagesResult } from './generate'
