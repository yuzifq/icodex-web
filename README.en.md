# iCodex

Due to possible security issues in the upstream npm package, this project uses a self-hosted deployment model for both internal and external access.

Before starting the project, download and install the Codex CLI or the Codex desktop application.

After downloading and extracting the release package, select `start-local.bat` to start the local network service.

Before selecting `start-cloud.bat`, run `cloud-first-setup.bat` to complete the initial cloud configuration.

### Notice

This project can no longer connect to the upstream app.

The frontend screenshots are shown at the bottom of this README.

## Project Features

- Vue 3 + Vite frontend
- Express CLI server
- Communication with the local Codex app-server
- Responsive Chinese interface for desktop and mobile layouts
- Local password protection

## Requirements

- Node.js 18+
- pnpm 9 or 10+

## Local Development

```bash
pnpm install
pnpm run dev
```

The development server starts Vite and accesses the local Codex service through the same-origin `/codex-api/*` routes.

## Build

```bash
pnpm run build
```

## Run the Built Service

```bash
node dist-cli/index.js --port 5900 --no-open
```

If neither `--password` nor `--no-password` is specified, the service generates a temporary password and writes it to the local Codex home directory.

## Screenshots

<img width="2549" height="1191" alt="iCodex screenshot 1" src="https://github.com/user-attachments/assets/47bead2a-43a0-4492-ae20-2e4f1599dbc9" />
<img width="2549" height="1191" alt="iCodex screenshot 2" src="https://github.com/user-attachments/assets/5934aa14-9116-46cf-b94a-1d96246f44c8" />
<img width="2549" height="1191" alt="iCodex screenshot 3" src="https://github.com/user-attachments/assets/a12ea958-0ca1-4e37-9cf4-5f382d9d9067" />
<img width="2549" height="1191" alt="iCodex screenshot 4" src="https://github.com/user-attachments/assets/0e0178a0-64b0-4fa8-8d1f-fd8c808fc333" />
<img width="2549" height="1191" alt="iCodex screenshot 5" src="https://github.com/user-attachments/assets/5ee3eabf-6f95-45bb-88b5-5189fffd942c" />
<img width="2549" height="1191" alt="iCodex screenshot 6" src="https://github.com/user-attachments/assets/e9c099cc-1fbd-4232-bc39-c042e868d022" />
