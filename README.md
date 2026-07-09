# iCodex

由于上游npm似乎出现某些安全问题，于是决定改为自主ip部署和内外部署

需提前下载codex cli,或者codex桌面端

下载压缩包后，选择本地启动.bat即启动内网访问

选择云端启动.bat前需使用云端首次配置.bat

### 注意：

该项目已经无法连接上游app


## 项目内容

- Vue 3 + Vite 前端
- Express CLI 服务端
- 与本机 Codex app-server 通信
- 中文界面与移动端布局调整
- 本地密码保护
- 可选 Cloudflare Tunnel / Tailscale 访问


## 环境要求

- Node.js 18+
- pnpm 9+ 或 10+

## 本地开发

```bash
pnpm install
pnpm run dev
```

开发服务会启动 Vite，并通过同源 `/codex-api/*` 访问本机 Codex 服务。

## 构建

```bash
pnpm run build
```

## 运行构建后的服务

```bash
node dist-cli/index.js --port 5900 --no-open
```

如果没有指定 `--password` 或 `--no-password`，服务会生成临时密码，并把密码写入本机 Codex home 目录。
