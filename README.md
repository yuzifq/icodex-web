# iCodex

简体中文 | [English](./README.en.md)

由于上游 npm 似乎出现某些安全问题，于是决定改为自主 IP 部署和内外部署。

需提前下载 Codex CLI，或者 Codex 桌面端。

下载压缩包后，选择本地启动 `.bat` 即启动内网访问。

选择云端启动 `.bat` 前需使用云端首次配置 `.bat`。

### 注意

该项目已经无法连接上游 app。

前端展示在 README 最下方。

## 项目内容

- Vue 3 + Vite 前端
- Express CLI 服务端
- 与本机 Codex app-server 通信
- 中文界面与移动端布局调整
- 本地密码保护

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

## 前端展示

<img width="2549" height="1191" alt="image" src="https://github.com/user-attachments/assets/47bead2a-43a0-4492-ae20-2e4f1599dbc9" />
<img width="2549" height="1191" alt="image" src="https://github.com/user-attachments/assets/5934aa14-9116-46cf-b94a-1d96246f44c8" />
<img width="2549" height="1191" alt="image" src="https://github.com/user-attachments/assets/a12ea958-0ca1-4e37-9cf4-5f382d9d9067" />
<img width="2549" height="1191" alt="image" src="https://github.com/user-attachments/assets/0e0178a0-64b0-4fa8-8d1f-fd8c808fc333" />
<img width="2549" height="1191" alt="image" src="https://github.com/user-attachments/assets/5ee3eabf-6f95-45bb-88b5-5189fffd942c" />
<img width="2549" height="1191" alt="image" src="https://github.com/user-attachments/assets/e9c099cc-1fbd-4232-bc39-c042e868d022" />
