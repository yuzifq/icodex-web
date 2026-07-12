import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyGithubDeviceTokenResponse, createGithubSkillsRepository, listOwnedGithubRepositories, validateSkillsRepository } from './skillsRoutes.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GitHub Skills repository selection', () => {
  it('keeps polling and backs off when GitHub asks the device flow to slow down', () => {
    expect(classifyGithubDeviceTokenResponse({ error: 'slow_down' })).toEqual({
      token: null,
      error: 'slow_down',
      pending: true,
      retryAfterSeconds: 5,
    })
  })

  it('lists only writable repositories owned by the logged-in user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      {
        name: 'skills',
        full_name: 'alice/skills',
        owner: { login: 'alice' },
        permissions: { push: true },
        size: 0,
        private: true,
        default_branch: 'main',
      },
      {
        name: 'shared',
        full_name: 'team/shared',
        owner: { login: 'team' },
        permissions: { push: true },
        size: 10,
      },
      {
        name: 'readonly',
        full_name: 'alice/readonly',
        owner: { login: 'alice' },
        permissions: { push: false },
        size: 10,
      },
    ])))

    await expect(listOwnedGithubRepositories('token', 'alice')).resolves.toEqual([
      expect.objectContaining({ fullName: 'alice/skills', empty: true, private: true }),
    ])
  })

  it('accepts an empty owned repository', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        name: 'skills',
        owner: { login: 'alice' },
        permissions: { push: true },
        size: 0,
        default_branch: 'main',
      }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404)))

    await expect(validateSkillsRepository('token', 'alice', 'alice', 'skills'))
      .resolves.toEqual({ empty: true, branch: 'main' })
  })

  it('creates a private Skills repository under the logged-in account', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      name: 'icodex-skills',
      full_name: 'alice/icodex-skills',
      owner: { login: 'alice' },
      permissions: { push: true },
      size: 0,
      private: true,
      default_branch: 'main',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createGithubSkillsRepository('token', 'alice', 'icodex-skills')).resolves.toEqual(
      expect.objectContaining({ fullName: 'alice/icodex-skills', private: true, empty: true }),
    )
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/user/repos', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      name: 'icodex-skills',
      private: true,
      auto_init: false,
    })
  })

  it('rejects an unsafe new repository name before calling GitHub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createGithubSkillsRepository('token', 'alice', '../skills')).rejects.toThrow('Enter a valid repository name')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-empty repository without a Skills manifest', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        name: 'website',
        owner: { login: 'alice' },
        permissions: { push: true },
        size: 12,
        default_branch: 'main',
      }))
      .mockResolvedValueOnce(jsonResponse([{ name: 'README.md', type: 'file' }])))

    await expect(validateSkillsRepository('token', 'alice', 'alice', 'website'))
      .rejects.toThrow('not empty and is not a Skills repository')
  })

  it('accepts a repository with a valid Skills manifest', async () => {
    const manifest = Buffer.from(JSON.stringify([{ owner: 'alice', name: 'demo', enabled: true }]), 'utf8').toString('base64')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        name: 'skills',
        owner: { login: 'alice' },
        permissions: { push: true },
        size: 12,
        default_branch: 'master',
      }))
      .mockResolvedValueOnce(jsonResponse([{ name: 'installed-skills.json', type: 'file' }]))
      .mockResolvedValueOnce(jsonResponse({ type: 'file', content: manifest })))

    await expect(validateSkillsRepository('token', 'alice', 'alice', 'skills'))
      .resolves.toEqual({ empty: false, branch: 'master' })
  })
})
