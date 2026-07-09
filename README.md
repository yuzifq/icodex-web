# iCodex

这是一个适合上传到 GitHub 的源码版 iCodex。它基于 Codex app-server 工作，提供本地浏览器、局域网和移动端访问能力。

## 项目内容

- Vue 3 + Vite 前端
- Express CLI 服务端
- 与本机 Codex app-server 通信
- 中文界面与移动端布局调整
- 本地密码保护
- 可选 Cloudflare Tunnel / Tailscale 访问

本仓库只保留源码、配置、文档、测试和锁文件；不包含便携运行包里的 `runtime/`、`node_modules/`、`dist/`、`dist-cli/`、`.ip-public/` 或个人启动脚本配置。

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

构建产物输出到：

- `dist/`
- `dist-cli/`

这些目录是构建产物，已经被 `.gitignore` 忽略，不建议提交到源码仓库。

## 运行构建后的服务

```bash
node dist-cli/index.js --port 5900 --no-open
```

如果没有指定 `--password` 或 `--no-password`，服务会生成临时密码，并把密码写入本机 Codex home 目录。

## 上传 GitHub 前检查

```bash
pnpm install
pnpm run build
pnpm run test:unit
git status --short
```

确认 Git 状态中只包含你准备提交的源码文件，不包含：

- `node_modules/`
- `dist/`
- `dist-cli/`
- `.codex/`
- `.env*`
- 本机绝对路径
- 个人密码、SMTP 授权码、Cloudflare 配置、IP 公网配置
