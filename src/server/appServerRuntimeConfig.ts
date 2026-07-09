import {
  parseCodexApprovalPolicy,
  parseCodexSandboxMode,
  type CodexApprovalPolicy,
  type CodexSandboxMode,
} from '../runtimeAccess.js'

export type { CodexApprovalPolicy, CodexSandboxMode } from '../runtimeAccess.js'

type AppServerRuntimeConfig = {
  sandboxMode: CodexSandboxMode
  approvalPolicy: CodexApprovalPolicy
  memories: boolean
}

const DEFAULT_RUNTIME_CONFIG: AppServerRuntimeConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  memories: true,
}

function normalizeRuntimeValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function readSandboxModeFromEnv(): CodexSandboxMode {
  return parseCodexSandboxMode(normalizeRuntimeValue(process.env.CODEXUI_SANDBOX_MODE))
    ?? DEFAULT_RUNTIME_CONFIG.sandboxMode
}

function readApprovalPolicyFromEnv(): CodexApprovalPolicy {
  return parseCodexApprovalPolicy(normalizeRuntimeValue(process.env.CODEXUI_APPROVAL_POLICY))
    ?? DEFAULT_RUNTIME_CONFIG.approvalPolicy
}

function readMemoriesFromEnv(): boolean {
  const candidate = normalizeRuntimeValue(process.env.CODEXUI_MEMORIES)
  if (candidate === 'false' || candidate === '0' || candidate === 'no') {
    return false
  }
  if (candidate === 'true' || candidate === '1' || candidate === 'yes') {
    return true
  }
  return DEFAULT_RUNTIME_CONFIG.memories
}

export function resolveAppServerRuntimeConfig(): AppServerRuntimeConfig {
  return {
    sandboxMode: readSandboxModeFromEnv(),
    approvalPolicy: readApprovalPolicyFromEnv(),
    memories: readMemoriesFromEnv(),
  }
}

export function buildAppServerArgs(): string[] {
  const config = resolveAppServerRuntimeConfig()
  return [
    'app-server',
    '-c',
    `approval_policy="${config.approvalPolicy}"`,
    '-c',
    `sandbox_mode="${config.sandboxMode}"`,
    '-c',
    `features.memories=${config.memories ? 'true' : 'false'}`,
  ]
}

export function parseSandboxMode(value: string): CodexSandboxMode | null {
  return parseCodexSandboxMode(value)
}

export function parseApprovalPolicy(value: string): CodexApprovalPolicy | null {
  return parseCodexApprovalPolicy(value)
}
