# 多智能体协作工作台

## 项目目标

建设一个面向个人本机使用的网页工作台，让用户发布通用需求，并按任务选择可配置的智能体参与讨论与分工。通过清晰拆解、过程可视化、交叉检查和精选共享记忆提高任务质量，同时避免无差别共享完整上下文。

## 产品方向

- 首版面向个人本机与单用户；不作为公网 SaaS 或多租户服务。
- 目标技术栈：TypeScript、React + Vite、Fastify、SQLite。
- 智能体接入保持可扩展；Codex、Hermes、DSH 仍是候选，不代表已集成。
- 目标协作模式包括协调者分工和多轮讨论；共享精选简报与按需证据。

## 当前状态（2026-10-10）

**第 0、1 期已完成；第 2 期底座实现与自动化验收已完成。**当前包含本机 React/Vite 前端、Fastify 服务、SQLite 元数据自检与健康状态界面。范围、安全和数据边界见 [`docs/PHASE-2-DECISIONS.md`](docs/PHASE-2-DECISIONS.md)，自动检查及剩余未验证事项见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。本期没有 agent 连接器、任务编排、任务正文/对话持久化或受控文件写入；浏览器本人验收仍未进行。

第 1 期是只读接入调查，不是连接器批准。Codex CLI 与 DSH Headless 是待评估候选；Hermes one-shot 有绕过交互审批风险；DSH `127.0.0.1:3080` 是 Web UI 而非已确认 Agent API。证据见 [`docs/INTEGRATION-RESEARCH.md`](docs/INTEGRATION-RESEARCH.md)，Paseo 对照见 [`docs/PASEO-COMPARISON.md`](docs/PASEO-COMPARISON.md)。Jet / RelayBoard 视觉参考和实际提示词来源目录尚待提供。

## 阶段协作

每期完成后汇报交付物、检查结果、未决问题与风险，然后等待用户明确批准下一期。路线图见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。第 3 期仍须另行批准。

## 目录

- `apps/web/`：本机 React/Vite 界面
- `apps/server/`：Fastify 本机服务、SQLite 初始化与健康检查
- `packages/shared/`：后续共享契约
- `packages/agent-adapters/`：后续智能体适配器
- `prompts/`：后续版本化系统/角色提示词
- `tests/`：后续跨应用测试；第 2 期测试在 `apps/server/test/`
- `docs/`：路线、架构、决策、调查与阶段实施基线

## 本机运行

环境：Node.js 24 或更高版本、pnpm 12 或兼容版本。

- 安装依赖：`pnpm install`
- 启动开发环境：`pnpm dev`（界面 `http://127.0.0.1:5173`，API `http://127.0.0.1:4317`）
- 类型检查、构建与测试：`pnpm typecheck`、`pnpm build`、`pnpm test`
- 生产运行：先 `pnpm build`，再 `pnpm start`，浏览器打开 `http://127.0.0.1:4317`
- 停止开发/生产服务：在运行终端按 Ctrl+C。当前 Windows Node 进程不依赖 SIGTERM graceful handling。
- 默认数据库路径为 Windows `%LOCALAPPDATA%\AgentOperationsManager\agent-operations-manager.sqlite`；可用 `AOM_DATA_DIR` 指定目录或 `AOM_DATABASE_PATH` 指定文件。

`node:sqlite` 为 Node.js 内置 SQLite API，仍需关注其实验性状态与后续版本变化。最终运行状态以实际构建和检查结果为准。
