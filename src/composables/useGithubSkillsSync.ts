import { computed, ref } from 'vue'

type ToastType = 'success' | 'error'

type SyncStartupStatus = {
  inProgress: boolean
  mode: string
  branch: string
  lastAction: string
  lastRunAtIso: string
  lastSuccessAtIso: string
  lastError: string
}

export type SkillsSyncStatus = {
  loggedIn: boolean
  githubUsername: string
  repoOwner: string
  repoName: string
  repoBranch: string
  configured: boolean
  startup: SyncStartupStatus
}

export type GithubRepository = {
  owner: string
  name: string
  fullName: string
  private: boolean
  empty: boolean
  defaultBranch: string
  updatedAt: string
}

type UseGithubSkillsSyncOptions = {
  showToast: (text: string, type?: ToastType) => void
  onPulled: () => Promise<void>
}

export function useGithubSkillsSync(options: UseGithubSkillsSyncOptions) {
  const sharedGithubClientId = 'Ov23liTfYBjPryE6UpwZ'
  const deviceLogin = ref<{
    device_code: string
    user_code: string
    verification_uri: string
    expires_in?: number
    interval?: number
  } | null>(null)
  const githubClientIdInput = ref('')
  const githubClientIdError = ref('')
  const isGithubClientIdPromptOpen = ref(false)
  const isGithubLoginInFlight = ref(false)
  const githubRepositories = ref<GithubRepository[]>([])
  const selectedGithubRepository = ref('')
  const githubRepositoryError = ref('')
  const isGithubRepositoryPromptOpen = ref(false)
  const isGithubRepositoryLoading = ref(false)
  const syncActionStatus = ref('')
  const syncActionError = ref('')
  const syncActionInFlight = ref<'pull' | 'push' | 'startup-sync' | ''>('')
  const syncStatus = ref<SkillsSyncStatus>({
    loggedIn: false,
    githubUsername: '',
    repoOwner: '',
    repoName: '',
    repoBranch: '',
    configured: false,
    startup: {
      inProgress: false,
      mode: 'idle',
      branch: 'main',
      lastAction: 'not-started',
      lastRunAtIso: '',
      lastSuccessAtIso: '',
      lastError: '',
    },
  })

  const isPullInFlight = computed(() => syncActionInFlight.value === 'pull')
  const isPushInFlight = computed(() => syncActionInFlight.value === 'push')
  const isStartupSyncInFlight = computed(() => syncActionInFlight.value === 'startup-sync')
  const isSyncActionInFlight = computed(() => syncActionInFlight.value !== '')

  async function loadSyncStatus(): Promise<void> {
    try {
      const resp = await fetch('/codex-api/skills-sync/status')
      if (!resp.ok) return
      const payload = (await resp.json()) as { data?: SkillsSyncStatus }
      if (payload.data) syncStatus.value = payload.data
    } catch {
      // best effort
    }
  }

  async function startGithubLogin(clientId = ''): Promise<void> {
    isGithubLoginInFlight.value = true
    githubClientIdError.value = ''
    let loginWindow: Window | null = null
    try {
      loginWindow = window.open('about:blank', 'codex-github-device-login')
      if (loginWindow) loginWindow.opener = null
    } catch {
      // The visible device-login link remains available when popups are blocked.
    }
    try {
      const startResp = await fetch('/codex-api/skills-sync/github/start-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clientId ? { clientId } : {}),
      })
      const startData = (await startResp.json()) as {
        code?: string
        error?: string
        data?: { device_code: string; user_code: string; verification_uri: string; expires_in?: number; interval?: number }
      }
      if (startData.code === 'github_oauth_client_id_required') {
        loginWindow?.close()
        isGithubClientIdPromptOpen.value = true
        return
      }
      if (!startResp.ok || !startData.data) throw new Error(startData.error || 'Failed to start GitHub login')
      isGithubClientIdPromptOpen.value = false
      githubClientIdInput.value = ''
      deviceLogin.value = startData.data
      if (loginWindow && !loginWindow.closed) {
        loginWindow.location.href = startData.data.verification_uri
      } else {
        window.open(startData.data.verification_uri, '_blank', 'noopener,noreferrer')
      }
      let waitMs = Math.max((startData.data.interval ?? 5) * 1000, 3000)
      const expiresInMs = Math.max((startData.data.expires_in ?? 900) * 1000, 60_000)
      const deadline = Date.now() + expiresInMs
      let loggedIn = false
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        const completeResp = await fetch('/codex-api/skills-sync/github/complete-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceCode: startData.data.device_code }),
        })
        const completeData = (await completeResp.json()) as {
          ok?: boolean
          pending?: boolean
          retryAfterSeconds?: number
          error?: string
          data?: { githubUsername?: string; repositories?: GithubRepository[] }
        }
        if (!completeResp.ok) throw new Error(completeData.error || 'Failed to complete GitHub login')
        if (completeData.ok) {
          syncActionError.value = ''
          syncActionStatus.value = ''
          githubRepositories.value = completeData.data?.repositories ?? []
          selectedGithubRepository.value = ''
          githubRepositoryError.value = githubRepositories.value.length > 0 ? '' : 'No owned repositories found'
          isGithubRepositoryPromptOpen.value = true
          loggedIn = true
          break
        }
        if (!completeData.pending) throw new Error(completeData.error || 'Failed to complete GitHub login')
        if ((completeData.retryAfterSeconds ?? 0) > 0) {
          waitMs += completeData.retryAfterSeconds! * 1000
        }
      }
      if (!loggedIn) throw new Error('GitHub login timed out. Please retry.')
      deviceLogin.value = null
      await loadSyncStatus()
      options.showToast('GitHub login successful')
    } catch (e) {
      try {
        if (loginWindow && !loginWindow.closed && loginWindow.location.href === 'about:blank') loginWindow.close()
      } catch {
        // The window may already be on GitHub and therefore cross-origin.
      }
      deviceLogin.value = null
      options.showToast(e instanceof Error ? e.message : 'Failed GitHub login', 'error')
    } finally {
      isGithubLoginInFlight.value = false
    }
  }

  async function configureGithubClientId(): Promise<void> {
    const clientId = githubClientIdInput.value.trim()
    if (!clientId || /\s/u.test(clientId)) {
      githubClientIdError.value = 'Enter a valid GitHub OAuth Client ID'
      return
    }
    await startGithubLogin(clientId)
  }

  async function useSharedGithubClientId(): Promise<void> {
    githubClientIdInput.value = sharedGithubClientId
    await startGithubLogin(sharedGithubClientId)
  }

  function closeGithubClientIdPrompt(): void {
    if (isGithubLoginInFlight.value) return
    isGithubClientIdPromptOpen.value = false
    githubClientIdError.value = ''
  }

  async function loadGithubRepositories(): Promise<void> {
    isGithubRepositoryLoading.value = true
    githubRepositoryError.value = ''
    try {
      const resp = await fetch('/codex-api/skills-sync/github/repositories')
      const payload = (await resp.json()) as { data?: { repositories?: GithubRepository[] }; error?: string }
      if (!resp.ok) throw new Error(payload.error || 'Failed to list GitHub repositories')
      githubRepositories.value = payload.data?.repositories ?? []
      selectedGithubRepository.value = ''
      if (githubRepositories.value.length === 0) githubRepositoryError.value = 'No owned repositories found'
    } catch (e) {
      githubRepositoryError.value = e instanceof Error ? e.message : 'Failed to list GitHub repositories'
    } finally {
      isGithubRepositoryLoading.value = false
    }
  }

  async function openGithubRepositoryPrompt(): Promise<void> {
    isGithubRepositoryPromptOpen.value = true
    await loadGithubRepositories()
  }

  function closeGithubRepositoryPrompt(): void {
    if (isGithubRepositoryLoading.value) return
    isGithubRepositoryPromptOpen.value = false
    githubRepositoryError.value = ''
  }

  async function selectGithubRepository(): Promise<void> {
    const selected = githubRepositories.value.find((repository) => repository.fullName === selectedGithubRepository.value)
    if (!selected) {
      githubRepositoryError.value = 'Select a repository'
      return
    }
    isGithubRepositoryLoading.value = true
    githubRepositoryError.value = ''
    try {
      const resp = await fetch('/codex-api/skills-sync/github/select-repository', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: selected.owner, name: selected.name }),
      })
      const payload = (await resp.json()) as { ok?: boolean; error?: string }
      if (!resp.ok || !payload.ok) throw new Error(payload.error || 'Failed to select Skills repository')
      isGithubRepositoryPromptOpen.value = false
      await loadSyncStatus()
      await options.onPulled()
      options.showToast('Skills repository connected')
    } catch (e) {
      githubRepositoryError.value = e instanceof Error ? e.message : 'Failed to select Skills repository'
    } finally {
      isGithubRepositoryLoading.value = false
    }
  }

  async function pullSkillsSync(): Promise<void> {
    syncActionError.value = ''
    syncActionStatus.value = 'pull-started'
    syncActionInFlight.value = 'pull'
    try {
      const resp = await fetch('/codex-api/skills-sync/pull', { method: 'POST' })
      const data = (await resp.json()) as { ok?: boolean; error?: string }
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Failed to pull synced skills')
      await options.onPulled()
      syncActionStatus.value = 'pull-success'
      options.showToast('Pulled skills from selected repository')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to pull sync'
      syncActionError.value = message
      syncActionStatus.value = 'pull-failed'
      options.showToast(message, 'error')
    } finally {
      syncActionInFlight.value = ''
    }
  }

  async function pushSkillsSync(): Promise<void> {
    syncActionError.value = ''
    syncActionStatus.value = 'push-started'
    syncActionInFlight.value = 'push'
    try {
      const resp = await fetch('/codex-api/skills-sync/push', { method: 'POST' })
      const data = (await resp.json()) as { ok?: boolean; error?: string }
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Failed to push synced skills')
      syncActionStatus.value = 'push-success'
      options.showToast('Pushed skills to selected repository')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to push sync'
      syncActionError.value = message
      syncActionStatus.value = 'push-failed'
      options.showToast(message, 'error')
    } finally {
      syncActionInFlight.value = ''
    }
  }

  async function startupSkillsSync(): Promise<void> {
    syncActionError.value = ''
    syncActionStatus.value = 'startup-sync-started'
    syncActionInFlight.value = 'startup-sync'
    try {
      const resp = await fetch('/codex-api/skills-sync/startup-sync', { method: 'POST' })
      const data = (await resp.json()) as { ok?: boolean; error?: string }
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Failed to run startup sync')
      await options.onPulled()
      await loadSyncStatus()
      syncActionStatus.value = 'startup-sync-success'
      options.showToast('Startup sync completed')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed startup sync'
      syncActionError.value = message
      syncActionStatus.value = 'startup-sync-failed'
      options.showToast(message, 'error')
    } finally {
      syncActionInFlight.value = ''
    }
  }

  async function logoutGithub(): Promise<void> {
    try {
      const resp = await fetch('/codex-api/skills-sync/github/logout', { method: 'POST' })
      const data = (await resp.json()) as { ok?: boolean; error?: string }
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Failed to logout GitHub')
      await loadSyncStatus()
      githubRepositories.value = []
      selectedGithubRepository.value = ''
      isGithubRepositoryPromptOpen.value = false
      options.showToast('Logged out from GitHub')
    } catch (e) {
      options.showToast(e instanceof Error ? e.message : 'Failed to logout GitHub', 'error')
    }
  }

  return {
    closeGithubClientIdPrompt,
    closeGithubRepositoryPrompt,
    configureGithubClientId,
    deviceLogin,
    githubClientIdError,
    githubClientIdInput,
    githubRepositories,
    githubRepositoryError,
    isGithubRepositoryLoading,
    isGithubRepositoryPromptOpen,
    isGithubClientIdPromptOpen,
    isGithubLoginInFlight,
    isPullInFlight,
    isPushInFlight,
    isStartupSyncInFlight,
    isSyncActionInFlight,
    loadSyncStatus,
    openGithubRepositoryPrompt,
    logoutGithub,
    pullSkillsSync,
    pushSkillsSync,
    selectGithubRepository,
    selectedGithubRepository,
    startupSkillsSync,
    startGithubLogin,
    syncActionError,
    syncActionStatus,
    syncStatus,
    useSharedGithubClientId,
  }
}
