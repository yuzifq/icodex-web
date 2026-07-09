import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { createConnection, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { connect as connectTls } from 'node:tls'
import type { RequestHandler, Request, Response, NextFunction } from 'express'

const TOKEN_COOKIE = 'portal_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_STORE_FILE = 'webui-auth-sessions.json'
const MAX_PERSISTED_TOKENS = 128
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000
const EMAIL_OTP_MAX_ATTEMPTS = 3
const SMTP_TIMEOUT_MS = 20000

type PersistedAuthState = {
  tokens?: Array<{
    value?: unknown
    expiresAt?: unknown
  }>
}

type EmailOtpConfig = {
  to: string
  from: string
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPass: string
}

type EmailOtpChallenge = {
  code: string
  expiresAt: number
  attempts: number
}

type LoginBody = {
  password?: string
  code?: string
}

function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    cookies[key] = value
  }
  return cookies
}

function isLocalhostRemote(remote: string): boolean {
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function isLocalhostHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized.startsWith('localhost:') || normalized === 'localhost' || normalized.startsWith('127.0.0.1:')
}

function isIPv4Octet(value: string): boolean {
  if (!/^\d{1,3}$/.test(value)) return false
  const parsed = Number.parseInt(value, 10)
  return parsed >= 0 && parsed <= 255
}

function isTrustedTailscaleIPv4(remote: string): boolean {
  const normalized = remote.startsWith('::ffff:') ? remote.slice('::ffff:'.length) : remote
  const parts = normalized.split('.')
  if (parts.length !== 4 || !parts.every(isIPv4Octet)) {
    return false
  }

  const first = Number.parseInt(parts[0] ?? '', 10)
  const second = Number.parseInt(parts[1] ?? '', 10)
  return first === 100 && second >= 64 && second <= 127
}

function isTrustedTailscaleIPv6(remote: string): boolean {
  const normalized = remote.toLowerCase()
  return normalized === 'fd7a:115c:a1e0::1' || normalized.startsWith('fd7a:115c:a1e0:')
}

function isTrustedTailscaleRemote(remote: string): boolean {
  return isTrustedTailscaleIPv4(remote) || isTrustedTailscaleIPv6(remote)
}

function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

function getSessionStorePath(): string {
  return join(getCodexHomeDir(), SESSION_STORE_FILE)
}

function readPersistedSessions(): Map<string, number> {
  const sessionStorePath = getSessionStorePath()
  if (!existsSync(sessionStorePath)) return new Map()

  try {
    const raw = readFileSync(sessionStorePath, 'utf8')
    const parsed = JSON.parse(raw) as PersistedAuthState
    const now = Date.now()
    const sessions = new Map<string, number>()
    for (const entry of parsed.tokens ?? []) {
      const token = typeof entry?.value === 'string' ? entry.value : ''
      const expiresAt = typeof entry?.expiresAt === 'number' ? entry.expiresAt : 0
      if (!token || !Number.isFinite(expiresAt) || expiresAt <= now) continue
      sessions.set(token, expiresAt)
    }
    return sessions
  } catch {
    return new Map()
  }
}

function persistSessions(validTokens: Map<string, number>): void {
  const sessionStorePath = getSessionStorePath()
  mkdirSync(dirname(sessionStorePath), { recursive: true })

  const tokens = Array.from(validTokens.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_PERSISTED_TOKENS)
    .map(([value, expiresAt]) => ({ value, expiresAt }))
  const tmpPath = `${sessionStorePath}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify({ tokens }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmpPath, sessionStorePath)
}

function tryPersistSessions(validTokens: Map<string, number>): void {
  try {
    persistSessions(validTokens)
  } catch (error) {
    console.warn('[auth] failed to persist login sessions:', error)
  }
}

function pruneExpiredSessions(validTokens: Map<string, number>): boolean {
  const now = Date.now()
  let changed = false
  for (const [token, expiresAt] of validTokens.entries()) {
    if (expiresAt > now) continue
    validTokens.delete(token)
    changed = true
  }
  return changed
}

function buildSessionCookie(token: string, expiresAt: number): string {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  return [
    `${TOKEN_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(maxAgeSeconds)}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join('; ')
}

function readBooleanEnv(name: string, defaultValue = false): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return defaultValue
  return ['1', 'true', 'yes', 'y', 'on'].includes(value)
}

function readEmailOtpConfig(): EmailOtpConfig | null {
  if (!readBooleanEnv('CODEXUI_EMAIL_OTP_ENABLED')) return null

  const to = process.env.CODEXUI_EMAIL_OTP_TO?.trim() ?? ''
  const smtpHost = process.env.CODEXUI_EMAIL_OTP_SMTP_HOST?.trim() ?? ''
  const smtpPortText = process.env.CODEXUI_EMAIL_OTP_SMTP_PORT?.trim() ?? ''
  const smtpPort = Number.parseInt(smtpPortText, 10)
  const smtpUser = process.env.CODEXUI_EMAIL_OTP_SMTP_USER?.trim() ?? ''
  const smtpPass = process.env.CODEXUI_EMAIL_OTP_SMTP_PASS ?? ''
  const from = process.env.CODEXUI_EMAIL_OTP_SMTP_FROM?.trim() || smtpUser || to
  const smtpSecure = readBooleanEnv('CODEXUI_EMAIL_OTP_SMTP_SECURE', smtpPort === 465)

  if (!to || !smtpHost || !Number.isFinite(smtpPort) || smtpPort < 1 || smtpPort > 65535 || !from) {
    console.warn('[auth] email verification is enabled but SMTP configuration is incomplete.')
    return null
  }

  return {
    to,
    from,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPass,
  }
}

function generateEmailCode(): string {
  return String(randomInt(0, 1000000)).padStart(6, '0')
}

function createSession(validTokens: Map<string, number>, res: Response): void {
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + SESSION_TTL_MS
  validTokens.set(token, expiresAt)
  tryPersistSessions(validTokens)
  res.setHeader('Set-Cookie', buildSessionCookie(token, expiresAt))
}

function encodeMimeWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/gu)?.join('\r\n') ?? value
}

function escapeSmtpData(value: string): string {
  return value.replace(/^\./gmu, '..')
}

function buildEmailMessage(config: EmailOtpConfig, code: string): string {
  const text = [
    'Codex UI verification code',
    '',
    `Your verification code is: ${code}`,
    '',
    'It expires in 10 minutes. If you enter it incorrectly 3 times, it will expire immediately.',
    '',
    'If you did not request this code, ignore this email.',
  ].join('\n')

  return [
    `From: ${config.from}`,
    `To: ${config.to}`,
    `Subject: ${encodeMimeWord('Codex UI verification code')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(text, 'utf8').toString('base64')),
  ].join('\r\n')
}

function isPositiveSmtpReply(response: string): boolean {
  return /^[23]\d\d[ -]/u.test(response)
}

function readSmtpResponse(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('SMTP response timed out'))
    }, SMTP_TIMEOUT_MS)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (/(^|\r?\n)\d{3} /u.test(buffer)) {
        cleanup()
        resolve(buffer)
      }
    }

    socket.on('data', onData)
    socket.once('error', onError)
  })
}

async function sendSmtpCommand(socket: Socket, command: string, expected = isPositiveSmtpReply): Promise<string> {
  socket.write(`${command}\r\n`)
  const response = await readSmtpResponse(socket)
  if (!expected(response)) {
    throw new Error(`SMTP command failed: ${response.trim()}`)
  }
  return response
}

function connectPlainSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('SMTP connection timed out'))
    }, SMTP_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function connectSecureSocket(host: string, port: number, socket?: Socket): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const secureSocket = connectTls({
      host,
      port,
      servername: host,
      socket,
    }, () => {
      resolve(secureSocket)
    })
    const timer = setTimeout(() => {
      secureSocket.destroy()
      reject(new Error('SMTP TLS connection timed out'))
    }, SMTP_TIMEOUT_MS)
    secureSocket.once('secureConnect', () => {
      clearTimeout(timer)
    })
    secureSocket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function sendEmailCode(config: EmailOtpConfig, code: string): Promise<void> {
  let socket = config.smtpSecure
    ? await connectSecureSocket(config.smtpHost, config.smtpPort)
    : await connectPlainSocket(config.smtpHost, config.smtpPort)
  try {
    const greeting = await readSmtpResponse(socket)
    if (!isPositiveSmtpReply(greeting)) {
      throw new Error(`SMTP greeting failed: ${greeting.trim()}`)
    }

    await sendSmtpCommand(socket, `EHLO localhost`)
    if (!config.smtpSecure && config.smtpPort === 587) {
      await sendSmtpCommand(socket, 'STARTTLS', (response) => /^220[ -]/u.test(response))
      socket = await connectSecureSocket(config.smtpHost, config.smtpPort, socket)
      await sendSmtpCommand(socket, `EHLO localhost`)
    }

    if (config.smtpUser || config.smtpPass) {
      const authPayload = Buffer.from(`\0${config.smtpUser}\0${config.smtpPass}`, 'utf8').toString('base64')
      await sendSmtpCommand(socket, `AUTH PLAIN ${authPayload}`)
    }

    await sendSmtpCommand(socket, `MAIL FROM:<${config.from}>`)
    await sendSmtpCommand(socket, `RCPT TO:<${config.to}>`)
    await sendSmtpCommand(socket, 'DATA', (response) => /^354[ -]/u.test(response))
    socket.write(`${escapeSmtpData(buildEmailMessage(config, code))}\r\n.\r\n`)
    const dataResponse = await readSmtpResponse(socket)
    if (!isPositiveSmtpReply(dataResponse)) {
      throw new Error(`SMTP DATA failed: ${dataResponse.trim()}`)
    }
    await sendSmtpCommand(socket, 'QUIT', () => true)
  } finally {
    socket.destroy()
  }
}

function readRequestJson<T>(req: Request): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}') as T)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Invalid request body'))
      }
    })
    req.once('error', reject)
  })
}

function isAuthorizedByRequestLike(
  remoteAddress: string | undefined,
  hostHeader: string | undefined,
  cookieHeader: string | undefined,
  validTokens: Map<string, number>,
): boolean {
  const remote = remoteAddress ?? ''
  // SSH reverse tunnels terminate on loopback, so remoteAddress alone is not enough
  // to prove this is a direct local browser request.
  if (isLocalhostRemote(remote) && isLocalhostHost(hostHeader ?? '')) {
    return true
  }
  if (isTrustedTailscaleRemote(remote)) {
    return true
  }

  const cookies = parseCookies(cookieHeader)
  const token = cookies[TOKEN_COOKIE]
  if (!token) return false
  const expiresAt = validTokens.get(token)
  return typeof expiresAt === 'number' && expiresAt > Date.now()
}

function buildLoginPageHtml(emailOtpEnabled: boolean): string {
  const emailOtpHtml = emailOtpEnabled
    ? `<div class="otp-panel">
<p class="hint">使用邮箱验证码登录，无需输入本机 Codex UI 密码。</p>
<button id="sendCode" type="button">发送验证码</button>
<label for="code">验证码</label>
<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码">
<button id="codeLogin" type="button">验证码登录</button>
</div>
<div class="divider"><span>备用密码登录</span></div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iCodex</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
.card{background:#171717;border:1px solid #262626;border-radius:12px;padding:2rem;width:100%;max-width:380px}
h1{font-size:1.25rem;font-weight:600;margin-bottom:1.5rem;text-align:center;color:#fafafa}
label{display:block;font-size:.875rem;color:#a3a3a3;margin-bottom:.5rem}
input{width:100%;padding:.625rem .75rem;background:#0a0a0a;border:1px solid #404040;border-radius:8px;color:#fafafa;font-size:1rem;outline:none;transition:border-color .15s}
input:focus{border-color:#3b82f6}
button{width:100%;padding:.625rem;margin-top:1rem;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:.9375rem;font-weight:500;cursor:pointer;transition:background .15s}
button:hover{background:#2563eb}
button:disabled{opacity:.65;cursor:default}
.hint{color:#a3a3a3;font-size:.875rem;line-height:1.45;margin-bottom:.75rem;text-align:center}
.divider{display:flex;align-items:center;gap:.75rem;margin:1.25rem 0 .75rem;color:#737373;font-size:.75rem}
.divider::before,.divider::after{content:"";height:1px;background:#2f2f2f;flex:1}
.error{color:#ef4444;font-size:.8125rem;margin-top:.75rem;text-align:center;display:none;line-height:1.4}
.success{color:#22c55e;font-size:.8125rem;margin-top:.75rem;text-align:center;display:none;line-height:1.4}
</style>
</head>
<body>
<div class="card">
<h1>iCodex</h1>
${emailOtpHtml}
<form id="f">
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Sign in</button>
<p class="error" id="err">Incorrect password</p>
<p class="success" id="ok"></p>
</form>
</div>
<script>
const form=document.getElementById('f');
const errEl=document.getElementById('err');
const okEl=document.getElementById('ok');
const codeEl=document.getElementById('code');
const sendCodeBtn=document.getElementById('sendCode');
const codeLoginBtn=document.getElementById('codeLogin');
function showError(message){
  if(okEl){okEl.style.display='none'}
  errEl.textContent=message;
  errEl.style.display='block';
}
function showOk(message){
  errEl.style.display='none';
  if(okEl){okEl.textContent=message;okEl.style.display='block'}
}
form.addEventListener('submit',async e=>{
  e.preventDefault();
  errEl.style.display='none';
  const res=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
  if(res.ok){window.location.reload()}else{showError('密码不正确');document.getElementById('pw').value='';document.getElementById('pw').focus()}
});
if(sendCodeBtn&&codeEl){
  sendCodeBtn.addEventListener('click',async()=>{
    sendCodeBtn.disabled=true;
    showOk('正在发送验证码...');
    try{
      const res=await fetch('/auth/email-code/send',{method:'POST'});
      if(res.ok){
        showOk('验证码已发送，请查看接收邮箱。');
        codeEl.focus();
      }else{
        showError('验证码发送失败，请检查 SMTP 配置或使用备用密码登录。');
      }
    }catch{
      showError('验证码发送失败，请稍后重试。');
    }finally{
      setTimeout(()=>{sendCodeBtn.disabled=false},3000);
    }
  });
}
if(codeLoginBtn&&codeEl){
  codeLoginBtn.addEventListener('click',async()=>{
    const code=codeEl.value.trim();
    if(!code){showError('请输入验证码');codeEl.focus();return}
    codeLoginBtn.disabled=true;
    try{
      const res=await fetch('/auth/email-code/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
      if(res.ok){
        window.location.reload();
        return;
      }
      const payload=await res.json().catch(()=>({}));
      if(payload&&payload.error==='expired'){
        showError('验证码已过期，请重新发送。');
      }else{
        showError('验证码不正确，连续错误 3 次后会自动过期。');
      }
      codeEl.value='';
      codeEl.focus();
    }catch{
      showError('验证码登录失败，请稍后重试。');
    }finally{
      codeLoginBtn.disabled=false;
    }
  });
}
</script>
</body>
</html>`
}

export function createAuthMiddleware(password: string): RequestHandler {
  return createAuthSession(password).middleware
}

export type AuthSession = {
  middleware: RequestHandler
  isRequestAuthorized: (req: IncomingMessage) => boolean
}

export function createAuthSession(password: string): AuthSession {
  const validTokens = readPersistedSessions()
  const emailOtpConfig = readEmailOtpConfig()
  let emailOtpChallenge: EmailOtpChallenge | null = null
  if (pruneExpiredSessions(validTokens)) {
    tryPersistSessions(validTokens)
  }

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    if (pruneExpiredSessions(validTokens)) {
      tryPersistSessions(validTokens)
    }

    if (isAuthorizedByRequestLike(req.socket.remoteAddress, req.headers.host, req.headers.cookie, validTokens)) {
      next()
      return
    }

    if (req.method === 'POST' && req.path === '/auth/email-code/send') {
      void (async () => {
        if (!emailOtpConfig) {
          res.status(404).json({ error: 'Email verification is not configured' })
          return
        }

        const code = generateEmailCode()
        try {
          await sendEmailCode(emailOtpConfig, code)
          emailOtpChallenge = {
            code,
            expiresAt: Date.now() + EMAIL_OTP_TTL_MS,
            attempts: 0,
          }
          res.json({ ok: true })
        } catch (error) {
          console.warn('[auth] failed to send email verification code:', error)
          emailOtpChallenge = null
          res.status(500).json({ error: 'Failed to send verification code' })
        }
      })()
      return
    }

    if (req.method === 'POST' && req.path === '/auth/email-code/login') {
      void (async () => {
        if (!emailOtpConfig) {
          res.status(404).json({ error: 'Email verification is not configured' })
          return
        }

        let parsed: LoginBody
        try {
          parsed = await readRequestJson<LoginBody>(req)
        } catch {
          res.status(400).json({ error: 'Invalid request body' })
          return
        }

        if (!emailOtpChallenge || emailOtpChallenge.expiresAt <= Date.now()) {
          emailOtpChallenge = null
          res.status(410).json({ error: 'expired' })
          return
        }

        const provided = typeof parsed.code === 'string' ? parsed.code.trim() : ''
        if (!constantTimeCompare(provided, emailOtpChallenge.code)) {
          emailOtpChallenge.attempts += 1
          if (emailOtpChallenge.attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
            emailOtpChallenge = null
            res.status(410).json({ error: 'expired' })
            return
          }
          res.status(401).json({ error: 'Invalid verification code', remainingAttempts: EMAIL_OTP_MAX_ATTEMPTS - emailOtpChallenge.attempts })
          return
        }

        try {
          emailOtpChallenge = null
          createSession(validTokens, res)
          res.json({ ok: true })
        } catch {
          res.status(500).json({ error: 'Failed to create login session' })
        }
      })()
      return
    }

    // Handle login POST
    if (req.method === 'POST' && req.path === '/auth/login') {
      void (async () => {
        let parsed: LoginBody
        try {
          parsed = await readRequestJson<LoginBody>(req)
        } catch {
          res.status(400).json({ error: 'Invalid request body' })
          return
        }

        const provided = typeof parsed.password === 'string' ? parsed.password : ''
        if (!constantTimeCompare(provided, password)) {
          res.status(401).json({ error: 'Invalid password' })
          return
        }

        try {
          createSession(validTokens, res)
          res.json({ ok: true })
        } catch {
          res.status(500).json({ error: 'Failed to create login session' })
        }
      })()
      return
    }

    // Handle one-click auth links like /password=<value>
    if (req.method === 'GET' && req.path.startsWith('/password=')) {
      const provided = req.path.slice('/password='.length)
      if (constantTimeCompare(provided, password)) {
        createSession(validTokens, res)
        res.redirect(302, '/')
        return
      }
    }

    // No valid session — serve login page
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(buildLoginPageHtml(Boolean(emailOtpConfig)))
  }

  return {
    middleware,
    isRequestAuthorized: (req: IncomingMessage) => (
      isAuthorizedByRequestLike(req.socket.remoteAddress, req.headers.host, req.headers.cookie, validTokens)
    ),
  }
}
