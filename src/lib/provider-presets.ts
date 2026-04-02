import type {
  ProviderCapability,
  ProviderPresetModule,
  ProviderPreset,
} from '@/types';
import { PROVIDER_PRESETS } from './provider-preset-data';

function presetSupportsCapability(
  preset: Pick<ProviderPreset, 'capabilities'>,
  capability?: ProviderCapability | null,
): boolean {
  if (!capability) {
    return true;
  }
  if (preset.capabilities.includes(capability)) {
    return true;
  }
  return false;
}

function presetSupportsModule(
  preset: Pick<ProviderPreset, 'supported_modules'>,
  moduleKey?: ProviderPresetModule | null,
): boolean {
  if (!moduleKey) {
    return true;
  }

  return preset.supported_modules?.includes(moduleKey) ?? true;
}

export function listProviderPresets(
  options?: {
    capability?: ProviderCapability | null;
    moduleKey?: ProviderPresetModule | null;
  },
): ProviderPreset[] {
  const capability = options?.capability ?? null;
  const moduleKey = options?.moduleKey ?? null;

  return PROVIDER_PRESETS
    .filter((preset) => presetSupportsCapability(preset, capability))
    .filter((preset) => presetSupportsModule(preset, moduleKey))
    .map((preset) => ({
      ...preset,
      capabilities: [...preset.capabilities],
      tags: preset.tags ? [...preset.tags] : undefined,
      supported_modules: preset.supported_modules ? [...preset.supported_modules] : undefined,
    }));
}

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return listProviderPresets().find((preset) => preset.id === id);
}
