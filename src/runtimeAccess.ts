export const CODEX_SANDBOX_MODES = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const

export const CODEX_APPROVAL_POLICIES = [
  'untrusted',
  'on-failure',
  'on-request',
  'never',
] as const

export const CODEX_ACCESS_MODES = [
  'request',
  'auto',
  'full',
  'read-only',
] as const

export type CodexSandboxMode = typeof CODEX_SANDBOX_MODES[number]
export type CodexApprovalPolicy = typeof CODEX_APPROVAL_POLICIES[number]
export type CodexAccessMode = typeof CODEX_ACCESS_MODES[number]

export type CodexRuntimeConfig = {
  sandboxMode: CodexSandboxMode
  approvalPolicy: CodexApprovalPolicy
  networkAccess: boolean
}

export type CodexTurnSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; access?: { type: 'fullAccess' } }
  | {
      type: 'workspaceWrite'
      writableRoots?: string[]
      networkAccess: boolean
      excludeTmpdirEnvVar?: boolean
      excludeSlashTmp?: boolean
    }

const SANDBOX_MODE_SET = new Set<string>(CODEX_SANDBOX_MODES)
const APPROVAL_POLICY_SET = new Set<string>(CODEX_APPROVAL_POLICIES)
const ACCESS_MODE_SET = new Set<string>(CODEX_ACCESS_MODES)

export function parseCodexSandboxMode(value: string): CodexSandboxMode | null {
  const candidate = value.trim().toLowerCase()
  return SANDBOX_MODE_SET.has(candidate) ? candidate as CodexSandboxMode : null
}

export function parseCodexApprovalPolicy(value: string): CodexApprovalPolicy | null {
  const candidate = value.trim().toLowerCase()
  return APPROVAL_POLICY_SET.has(candidate) ? candidate as CodexApprovalPolicy : null
}

export function normalizeCodexAccessMode(value: unknown): CodexAccessMode {
  if (typeof value !== 'string') return 'request'
  if (ACCESS_MODE_SET.has(value)) return value as CodexAccessMode
  if (value === 'failure') return 'auto'
  if (value === 'readonly') return 'request'
  return 'request'
}

export function normalizeCodexRuntimeConfig(value: unknown): CodexRuntimeConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const sandboxMode = typeof record.sandboxMode === 'string' ? parseCodexSandboxMode(record.sandboxMode) : null
  const approvalPolicy = typeof record.approvalPolicy === 'string' ? parseCodexApprovalPolicy(record.approvalPolicy) : null
  if (!sandboxMode || !approvalPolicy) return null
  const networkAccess = typeof record.networkAccess === 'boolean'
    ? record.networkAccess
    : inferNetworkAccess(sandboxMode, approvalPolicy)
  return { sandboxMode, approvalPolicy, networkAccess }
}

export function runtimeConfigForAccessMode(mode: CodexAccessMode): CodexRuntimeConfig {
  switch (mode) {
    case 'read-only':
      return { sandboxMode: 'read-only', approvalPolicy: 'untrusted', networkAccess: false }
    case 'auto':
      return { sandboxMode: 'workspace-write', approvalPolicy: 'on-failure', networkAccess: true }
    case 'request':
      return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', networkAccess: false }
    case 'full':
    default:
      return { sandboxMode: 'danger-full-access', approvalPolicy: 'never', networkAccess: true }
  }
}

export function accessModeForRuntimeConfig(config: CodexRuntimeConfig): CodexAccessMode {
  if (config.sandboxMode === 'danger-full-access') return 'full'
  if (config.sandboxMode === 'read-only') return 'read-only'
  if (config.approvalPolicy === 'on-failure') return 'auto'
  return 'request'
}

export function runtimeConfigFromThreadSettings(
  approvalPolicy: unknown,
  sandbox: unknown,
): CodexRuntimeConfig | null {
  const parsedApprovalPolicy = typeof approvalPolicy === 'string'
    ? parseCodexApprovalPolicy(approvalPolicy)
    : null
  if (!parsedApprovalPolicy || !sandbox || typeof sandbox !== 'object' || Array.isArray(sandbox)) return null

  const record = sandbox as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''
  switch (type) {
    case 'dangerFullAccess':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: parsedApprovalPolicy,
        networkAccess: true,
      }
    case 'readOnly':
      return {
        sandboxMode: 'read-only',
        approvalPolicy: parsedApprovalPolicy,
        networkAccess: false,
      }
    case 'workspaceWrite':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: parsedApprovalPolicy,
        networkAccess: record.networkAccess === true,
      }
    case 'externalSandbox':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: parsedApprovalPolicy,
        networkAccess: record.networkAccess === 'enabled' || record.networkAccess === true,
      }
    default:
      return null
  }
}

export function runtimeConfigFromConfig(value: unknown): CodexRuntimeConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const sandboxMode = typeof record.sandbox_mode === 'string'
    ? parseCodexSandboxMode(record.sandbox_mode)
    : null
  const approvalPolicy = typeof record.approval_policy === 'string'
    ? parseCodexApprovalPolicy(record.approval_policy)
    : null
  if (!sandboxMode || !approvalPolicy) return null

  const workspaceWrite = record.sandbox_workspace_write
  const workspaceWriteRecord = workspaceWrite && typeof workspaceWrite === 'object' && !Array.isArray(workspaceWrite)
    ? workspaceWrite as Record<string, unknown>
    : null
  const networkAccess = sandboxMode === 'workspace-write' && typeof workspaceWriteRecord?.network_access === 'boolean'
    ? workspaceWriteRecord.network_access
    : inferNetworkAccess(sandboxMode, approvalPolicy)
  return { sandboxMode, approvalPolicy, networkAccess }
}

export function threadStartRuntimeParams(config: CodexRuntimeConfig): {
  approvalPolicy: CodexApprovalPolicy
  sandbox: CodexSandboxMode
} {
  return {
    approvalPolicy: config.approvalPolicy,
    sandbox: config.sandboxMode,
  }
}

export function turnStartRuntimeParams(config: CodexRuntimeConfig): {
  approvalPolicy: CodexApprovalPolicy
  sandboxPolicy: CodexTurnSandboxPolicy
} {
  return {
    approvalPolicy: config.approvalPolicy,
    sandboxPolicy: turnSandboxPolicyForRuntimeConfig(config),
  }
}

export function turnSandboxPolicyForSandboxMode(mode: CodexSandboxMode): CodexTurnSandboxPolicy {
  return turnSandboxPolicyForRuntimeConfig({
    sandboxMode: mode,
    approvalPolicy: mode === 'danger-full-access' ? 'never' : 'on-request',
    networkAccess: mode === 'danger-full-access',
  })
}

function inferNetworkAccess(sandboxMode: CodexSandboxMode, approvalPolicy: CodexApprovalPolicy): boolean {
  if (sandboxMode === 'danger-full-access') return true
  if (sandboxMode === 'read-only') return false
  return approvalPolicy !== 'on-request'
}

function turnSandboxPolicyForRuntimeConfig(config: CodexRuntimeConfig): CodexTurnSandboxPolicy {
  const { sandboxMode, networkAccess } = config
  switch (sandboxMode) {
    case 'read-only':
      return { type: 'readOnly', access: { type: 'fullAccess' } }
    case 'workspace-write':
      return {
        type: 'workspaceWrite',
        writableRoots: [],
        networkAccess,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      }
    case 'danger-full-access':
    default:
      return { type: 'dangerFullAccess' }
  }
}
