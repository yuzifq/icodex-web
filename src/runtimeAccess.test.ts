import { describe, expect, it } from 'vitest'
import {
  accessModeForRuntimeConfig,
  runtimeConfigForAccessMode,
  runtimeConfigFromThreadSettings,
} from './runtimeAccess'

describe('runtime access settings', () => {
  it.each([
    ['request', { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', networkAccess: false }],
    ['auto', { sandboxMode: 'workspace-write', approvalPolicy: 'on-failure', networkAccess: true }],
    ['full', { sandboxMode: 'danger-full-access', approvalPolicy: 'never', networkAccess: true }],
    ['read-only', { sandboxMode: 'read-only', approvalPolicy: 'untrusted', networkAccess: false }],
  ] as const)('maps the %s preset to Codex CLI runtime parameters', (mode, expected) => {
    expect(runtimeConfigForAccessMode(mode)).toEqual(expected)
  })

  it('restores a workspace-write policy returned by a resumed thread', () => {
    const config = runtimeConfigFromThreadSettings('on-failure', {
      type: 'workspaceWrite',
      networkAccess: true,
    })

    expect(config).toEqual({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-failure',
      networkAccess: true,
    })
    expect(accessModeForRuntimeConfig(config!)).toBe('auto')
  })

  it('restores full access returned by a resumed thread', () => {
    const config = runtimeConfigFromThreadSettings('never', { type: 'dangerFullAccess' })

    expect(config).toEqual({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      networkAccess: true,
    })
    expect(accessModeForRuntimeConfig(config!)).toBe('full')
  })
})
