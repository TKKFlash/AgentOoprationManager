# 架构概述（阶段性）

> 本文区分用户已确认方向、研究建议和待验证能力；未验证的连接协议/鉴权/权限不得描述为已支持。

## 已确认的方向

- 面向个人本机使用，通过浏览器网页连接本机服务；首版不设计为公网 SaaS 或多租户团队系统。
- 目标技术组合为 React + Vite、TypeScript、Fastify 和 SQLite。依赖版本、部署/启动方式和数据库 schema 留待实施阶段确认。
- 智能体接入需可扩展；Codex、Hermes、DSH 是调查对象，不是已完成的集成。
- 目标协作模式包括协调者分工和多轮讨论；共享上下文采用精选简报和按需提供的证据，而非默认传递完整对话历史。

## 目标组件边界

- `apps/web/`：任务创建、agent 选择、讨论室、动态步骤时间线和产物审阅。
- `apps/server/`：本机任务编排、适配器生命周期、策略实施、持久化和事件发布。
- `packages/shared/`：未来的前后端任务与事件契约；本阶段尚无 API 或 wire schema。
- `packages/agent-adapters/`：隔离不同 agent 的启动、协议和事件差异。
- `prompts/system/`、`prompts/roles/`：未来存放版本化协作规则和角色提示。
- `tests/`：未来单元及集成测试。

上述均为目录职责目标，不代表已有运行代码或兼容性承诺。

## 目标信息流

1. 用户提交任务，选择参与 agent、协作模式及必要的授权范围。
2. 系统创建任务并固定所选配置、提示词/策略版本与最小必要上下文快照。
3. coordinator 根据所选模式安排动态步骤，并向对应 agent 定向提供任务简报和相关证据。
4. adapter 在服务端批准的权限边界内收发消息、状态、取消/审批事件及产物元数据。
5. UI 展示讨论、时间线、阻塞/审批与交付物；如获授权写入，则可审阅变更差异。
6. 任务结束后按记忆治理规则处理适合复用的信息；Flash Vault 的读写必须服从 Vault 自身规则和来源追踪要求。

这是一项目标流程，不是当前运行实现。

## 建议的领域模型（待实施阶段确认）

- **Task**：用户目标、验收标准、授权范围和共享上下文策略；不要求一定对应一个代码目录。
- **AgentProfile**：provider、model、transport、能力、角色用途、工具/资源上限及配置版本；角色说明可帮助推荐分工，但由用户选择参与者。
- **AgentSession / Run**：某个 agent 在一个任务中的执行会话或一次调用；配置快照在启动时固定。
- **Step / Event**：动态步骤状态、消息、审批、错误和产物引用；时间线应可追溯并能处理客户端断线恢复。
- **Handoff Packet**：最小化交接数据，只包含子任务目标、职责、相关证据、约束、已确认事项和交付格式；需要更多材料时按需提供。

这些术语是设计建议，不是批准的 schema。

## 协作模式参考

- 协调者对独立研究任务进行 fan-out，收集短格式结果后综合。
- 代码等适合并行写入的任务可使用独立 worktree/资源隔离；其他通用任务不强制工作树。
- 关键产物可交给另一个独立 agent/profile 复核，审查输入优先为 diff、验收标准和相关证据。
- 默认不启用无终止条件的 agent-to-agent mesh；需另行论证上下文预算、失败恢复、权限和停止条件。
- Paseo 的具体对照与来源见 [`PASEO-COMPARISON.md`](PASEO-COMPARISON.md)。只借鉴公开架构与流程，不复用未确认协议或依赖；保持既定技术栈。

## 第 2 期实际底座（2026-10-10）

- Web 使用 React + Vite，Fastify 提供本机服务，SQLite 使用 Node.js 24 内置 `node:sqlite`，不增加原生数据库依赖。该 SQLite API 仍属实验性，后续版本需复核。
- 开发服务分别绑定 `127.0.0.1:5173`（Vite）和 `127.0.0.1:4317`（Fastify）；生产由 Fastify 同时提供前端构建产物与 API。
- API 校验 Host 精确匹配 `127.0.0.1:<当前端口>`；非安全方法要求 Origin 与服务来源完全匹配，开发期另允许 `http://127.0.0.1:5173`。Loopback 不构成身份验证，也不能防范所有本机恶意进程。
- 默认 SQLite 路径为 `%LOCALAPPDATA%\AgentOperationsManager\agent-operations-manager.sqlite`；可通过 `AOM_DATA_DIR` 或 `AOM_DATABASE_PATH` 显式调整。当前仅保存 schema 版本与启动时间元数据。
- 健康检查、安全来源校验、静态页面服务、SQLite 初始化及启动过程已自动化验证；浏览器人工验收未进行。
## 本机安全与任务版本边界

- 服务默认仅面向本机并绑定 loopback；第 2 期已实现 Host/Origin 校验和安全响应头，但尚不提供用户认证，亦未验证抵御所有 DNS rebinding 或本机恶意进程威胁。
- agent 只能使用已核验并授权的连接能力。默认只读；用户明确授权后才允许在限定目录与动作范围内写入；删除、覆盖、越权和外部系统写入须依全局/项目规则取得确认。
- 子进程命令、工具集、cwd、路径和密钥传递均需最小化。adapter 能力或 UI 提示本身不是 OS 沙箱。
- 每个任务开始时固定 agent 配置、提示词、权限策略和上下文快照；更新只对新任务生效。
- agent/plugin 可能以服务账号身份获得较高宿主权限，不能把“工具隐藏”或“插件接口”当作隔离机制。

## 第 1 期接入调查结论（2026-10-09）

详见 [`INTEGRATION-RESEARCH.md`](INTEGRATION-RESEARCH.md)。关键调查事实：

- 本机 DSH `127.0.0.1:3080` 的监听进程为 `pnpm dsh web`，属于浏览器 UI；不是已确认的 Agent API。本次仅查看未经认证的 HTTP 状态，未携带认证凭据验证其 API。
- 本机 Codex CLI `exec --json` 和 DSH Headless `--json` 是结构化 CLI 候选；取消、事件 schema 和实际 sandbox 边界没有通过真实任务端到端测试。
- 本机 Hermes runtime 为 `0.21.0-cn.18`；`-z` one-shot 自动绕过交互审批；`acp --check` 因缺少 ACP optional dependencies 失败；API Server 是否启用未核实。
- DSH ACP 支持 stdio 多会话、事件和取消；其 `authenticate` 不做认证，故只能作为可信本机子进程候选，不能暴露为无认证网络服务。本机 ACP profile 缺运行依赖。

这批结论是规划调查，不代表任何 adapter 已实现或已批准。

## 待验证能力

- Codex JSONL 实际事件 schema、可靠取消、沙箱边界、Windows 路径授权和审批交互。
- Hermes 受限只读工具策略、API Server 配置/认证，以及当前 runtime 对应 ACP 可用性。
- DSH Headless/ACP 真实任务流、终止行为、权限边界、工作区 allowlist 和依赖管理。
- UI 的 Jet / RelayBoard 视觉参考和内置提示词包的来源目录。

## 持久化方向（未定 schema）

后续 SQLite 需支持任务、步骤、运行事件、配置/版本快照引用、审批、产物元数据和记忆来源关系。表结构、保留期限、附件存放、并发与备份策略留待该实施阶段确认和测试。
