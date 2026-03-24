export type CapabilityStatus =
  | 'draft'
  | 'validation_failed'
  | 'testing'
  | 'test_failed'
  | 'awaiting_approval'
  | 'ready_to_publish'
  | 'published'
  | 'disabled'
  | 'archived';

export type CapabilityCategory = 'document' | 'integration' | 'browser-helper' | 'data';
export type CapabilityKind = 'code' | 'prompt';

export type CapabilityRiskLevel = 'low' | 'medium' | 'high';

export type CapabilityImplementation =
  | {
      kind: 'builtin-adapter';
      adapterId: string;
      config: Record<string, unknown>;
    }
  | {
      kind: 'reviewed-package';
      packageId: string;
      packageVersion: string;
      entry: string;
    }
  | {
      kind: 'inline-code';
      source: string;
      generatedSummary?: string;
      usageExamples?: string[];
    }
  | {
      kind: 'inline-prompt';
      source: string;
      generatedSummary?: string;
      usageExamples?: string[];
    };

export interface CapabilityPackage {
  id: string;
  name: string;
  description: string;
  version: string;
  digest?: string;
  status: CapabilityStatus;
  kind?: CapabilityKind;
  category: CapabilityCategory;
  riskLevel: CapabilityRiskLevel;

  scope: {
    visibility: 'global' | 'workspace' | 'team';
    workspaceId?: string;
    teamId?: string;
  };

  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;

  permissions: {
    workspaceRead?: boolean;
    workspaceWrite?: boolean;
    shellExec?: boolean;
    network?: boolean;
  };

  runtimePolicy: {
    timeoutMs: number;
    maximumAttempts: number;
  };

  approvalPolicy: {
    requireHumanApproval: boolean;
    approverRoles: string[];
  };

  implementation: CapabilityImplementation;

  tests: Array<{
    name: string;
    input: Record<string, unknown>;
    expectedAssertions: string[];
  }>;

  docs: {
    summary: string;
    usageExamples: string[];
  };

  createdAt: string;
  updatedAt: string;
}

export interface CapabilityDraft {
  id: string;
  name: string;
  description: string;
  kind?: CapabilityKind;
  category: CapabilityCategory;
  riskLevel: CapabilityRiskLevel;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissions?: Partial<CapabilityPackage['permissions']>;
  implementation?: CapabilityImplementation;
  validationErrors?: string[];
  createdAt: string;
  updatedAt: string;
}

export function deriveCapabilityKind(
  implementation?: CapabilityImplementation | null
): CapabilityKind {
  if (implementation?.kind === 'inline-code') {
    return 'code';
  }
  if (implementation?.kind === 'inline-prompt') {
    return 'prompt';
  }
  return 'code';
}
