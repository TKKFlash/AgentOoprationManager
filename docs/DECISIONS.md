# 决策、建议与开放问题

本记录区分用户已确认、AI 调查/建议与仍待决事项，避免把方案误记为实施批准。

## 用户已确认

- **项目位置：**在当前 `D:\document\AgentOoprationManager` 建立独立项目，不扩展旁边其他项目。
- **第 0 期范围：**目录骨架与 Markdown 文档；唯一权威项目约束文件使用 `AGENTS.md`，不在该期创建应用代码、依赖配置或安装依赖。
- **部署目标：**个人本机网页与本机服务，首版单用户；任务面向通用工作。
- **目标技术栈：**TypeScript 全栈，React + Vite、Fastify、SQLite。
- **协作方向：**协调者分工与多轮讨论两种模式均纳入目标。
- **上下文与记忆：**使用结构化简报和按需材料，避免向所有 agent 共享完整上下文；记忆可沉淀进 Flash Vault。
- **执行与可视化：**任务范围和运行过程需清楚可见、可追踪；用户选择任务授权范围内可直接执行并审阅改动；破坏性行为仍按人工审批规则。
- **分期审批：**每期完成后先汇报并等待明确批准再开始下一期。
- **Paseo：**用户指定 `getpaseo/paseo` 作为 agent 协作方式与架构的参考，不等于批准复制源代码、引入依赖或替换技术栈。
- **第 2 期基线：**2026-10-10 用户确认本机 loopback、Host/Origin 校验、用户级 SQLite 元数据存储、启动与错误处理范围；明确不包含任务、对话、agent 连接器和受控文件写入。实际验收见 `ROADMAP.md`。

## AI 调查结论（2026-10-09，未由用户确认为实现决策）

- 本机 DSH 的 `127.0.0.1:3080` 属于 `pnpm dsh web` 浏览器 UI，并非已确认的 agent endpoint。本地观测 HTTP 根路径为 401，但本次没有携带认证凭据验证具体运行时鉴权。
- 本机 Codex CLI `exec --json` 与 DSH Headless `--json` 是结构化 CLI 候选；真实任务事件、取消和平台 sandbox 强度尚未 e2e 验证。
- Hermes one-shot `-z` 自动绕过内部交互审批；当前本机 Hermes ACP 检查因缺 optional dependencies 失败。Hermes API Server 是另一独立能力，默认是否启用未核实。
- DSH ACP 支持 stdio 多 session、事件和取消，但 ACP `authenticate` 不要求认证；只能评估受控 stdio 子进程边界，不能把它暴露为未经认证的网络接口。
- Paseo 值得进一步考虑的模式：profile + 角色用途说明、Task/AgentSession 分离、最小化 handoff、独立复核、合适场景下 worktree 隔离，以及事件重连后的历史补读；不因此自动采纳 mesh、插件或上游内部 protocol。
- 详细事实、来源及限制分别见 [`INTEGRATION-RESEARCH.md`](INTEGRATION-RESEARCH.md) 与 [`PASEO-COMPARISON.md`](PASEO-COMPARISON.md)。

## AI 建议（尚未批准实施）

- 建立通用 adapter 与能力声明；CLI/ACP/HTTP 等按能力选择，不统一假设所有 agent 是 Chat Completions。
- coordinator 默认定向传递最小 handoff packet；先做可限预算、可取消的分层协作，不启用无限 peer-to-peer mesh。
- 对任务、agent session、run event 分层建模；Profile 记录角色用途并在任务启动时固定配置版本。
- 默认使用只读权限；写操作需任务级目录/动作授权，服务端实施范围校验并展示变更差异。
- Hermes one-shot 的审批绕过风险须通过受限工具 profile 规避并实测；否则暂不作为可执行型接入。
- 代码并发修改可按需要采用 worktree；对非代码任务不强制创建目录/工作树。

## 开放问题／待后续阶段确定

- 工作台是完整 orchestration host（能创建/管理 provider session）还是首版只包装本机 CLI？如何与用户手动打开的 agent Web UI 分工？
- 第 2/3 期是否批准对 Codex/DSH 进行安全、只读、限制工作目录的真实模型调用验证？
- 若 DSH Web 需程序化集成，是否存在经官方确认、稳定且可安全授权的外部 API/SDK？不直接读取其浏览器 cookie/session。
- Hermes 在 ACP optional dependencies 缺失时，是否选用 MCP、TUI gateway 或通过用户显式授权安装组件？是否单独启用 API Server 及其 `API_SERVER_KEY`？
- DSH ACP 无传输认证时的进程、stdio、session workspace 与外部 MCP 配置边界如何在本机实现和验证？
- 提示词包来源目录、角色 profile 字段、轮数/调用数预算、实时事件传输方式及事件补读策略为何？
- Jet / RelayBoard 的视觉参考截图或网址尚未收到。

## 审批状态

2026-10-09 用户批准并完成第 1 期只读调查。2026-10-10 用户批准第 2 期，范围与验收基线见 [`PHASE-2-DECISIONS.md`](PHASE-2-DECISIONS.md)；该期自动化验收完成，浏览器本人验收未进行。运行限制见 [`ROADMAP.md`](ROADMAP.md)。
