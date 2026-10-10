# Docker 与容器（未验证）

> 本文件记录容器构建的设计与已知限制。**本机未运行 Docker，镜像未构建，容器未启动，全部内容待验证。**

## 1. 构建设计

`Dockerfile` 采用两阶段构建：

- **build 阶段**（`node:24-alpine`）：启用 corepack；先复制 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.base.json` 与各 workspace 的 `package.json`，执行 `pnpm install --frozen-lockfile`；再复制源码并执行 `pnpm build`。
- **runtime 阶段**（`node:24-alpine`）：设置 `NODE_ENV=production`；仅复制 `node_modules`、服务端的 `package.json`、`node_modules` 与 `dist`、前端的 `dist`，以及 `packages/shared` 与 `packages/agent-adapters` 的 `package.json` 与 `dist`；入口为 `node apps/server/dist/index.js`，暴露 4317。

`.dockerignore` 排除 `.git`、依赖目录、构建产物、`.env` 与 SQLite 文件。

## 2. 已知限制

- **绑定地址**：服务绑定 `127.0.0.1`。在容器内，这意味着宿主机无法直接访问服务端口。改为绑定 `0.0.0.0` 属于安全边界变更，须用户批准，并同时考虑 Host 与 Origin 校验的配置。
- **codex CLI**：镜像不包含 `codex` 命令。选择 Codex 参与者时，步骤会以“失败”结束。
- **数据目录**：未设置 `AOM_DATA_DIR` 时，数据库位于 `$HOME/.local/share/agent-operations-manager/`。容器内需挂载数据卷才能保留数据（未配置）。
- **锁文件**：`pnpm install --frozen-lockfile` 要求 `pnpm-lock.yaml` 与各 `package.json` 一致。

## 3. 待验证

- 镜像能否构建成功（含 `pnpm build` 与 workspace 链接）。
- 运行时的 `node apps/server/dist/index.js` 能否找到 `@aom/shared` 与 `@aom/agent-adapters`（依赖符号链接在复制后是否有效）。
- 健康检查、界面静态文件与数据库初始化在容器内的行为。
