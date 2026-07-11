import { afterEach, describe, expect, it } from 'vitest'
import { buildAppServerArgs } from './appServerRuntimeConfig'

const originalApprovalPolicy = process.env.CODEXUI_APPROVAL_POLICY
const originalSandboxMode = process.env.CODEXUI_SANDBOX_MODE
const originalMemories = process.env.CODEXUI_MEMORIES

afterEach(() => {
  process.env.CODEXUI_APPROVAL_POLICY = originalApprovalPolicy
  process.env.CODEXUI_SANDBOX_MODE = originalSandboxMode
  process.env.CODEXUI_MEMORIES = originalMemories
})

describe('buildAppServerArgs', () => {
  it('does not override the CLI saved permission settings by default', () => {
    delete process.env.CODEXUI_APPROVAL_POLICY
    delete process.env.CODEXUI_SANDBOX_MODE
    delete process.env.CODEXUI_MEMORIES

    expect(buildAppServerArgs()).toEqual([
      'app-server',
      '-c',
      'features.memories=true',
    ])
  })

  it('passes explicit runtime overrides through to the CLI', () => {
    process.env.CODEXUI_APPROVAL_POLICY = 'never'
    process.env.CODEXUI_SANDBOX_MODE = 'danger-full-access'

    expect(buildAppServerArgs()).toEqual([
      'app-server',
      '-c',
      'approval_policy="never"',
      '-c',
      'sandbox_mode="danger-full-access"',
      '-c',
      'features.memories=true',
    ])
  })
})
