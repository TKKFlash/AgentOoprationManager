# Paseo 协作方式与架构对照

**研究对象：**用户指定的 [getpaseo/paseo](https://github.com/getpaseo/paseo)  
**研究日期：**2026-10-09  
**性质：**架构/工作流研究建议；不是采用 Paseo 依赖、复制其代码或修改已确认技术栈的批准。

## 主要观察

Paseo 是一个本机 agent 工作台/daemon 项目：agent provider 在 daemon 所在环境运行，app、CLI、SDK 作为 client 连接并观察 agent workspaces/sessions。其 profile 把实际 provider/model/启动配置与“何时委派给该 agent”的角色说明放在一起；调度不只是向同一聊天广播所有上下文。仓库在 package 边界上区分 client SDK、daemon、providers、protocol、plugins 等组件；应采用上层公开 SDK，而不是不经验证地依赖内部协议细节。

官方协作示例包含：多个 agent 并行只读调查，协调者合并结果；写任务每个独立改动建立 worktree/隔离 workspace；实施者完成后由另一个 agent 作为独立 reviewer 审查；agent 之间可被明确要求通过 identity 联系。SDK 事件通过显式订阅进行观察，重连后要由 client 知道如何补读缺失历史；不能假定 UI 在线就等于事件天然不丢。

来源： [Agent orchestration workflows](https://paseo.sh/docs/orchestration-workflows)、[Providers](https://paseo.sh/docs/providers)、[Agent profiles](https://paseo.sh/docs/agent-profiles)、[Workspaces](https://paseo.sh/docs/workspaces)、[SDK events](https://paseo.sh/docs/sdk/events)、[Public client SDK](https://github.com/getpaseo/paseo/tree/main/packages/client)。

## 对照与映射

| 设计主题 | Paseo 体现 | 本项目建议 | 约束/差异 |
|---|---|---|---|
| Host vs UI | daemon 管 provider/agent；多个 client 消费 daemon | Fastify 本机服务拥有任务、adapter 和策略；Vite UI 只作为 client | 保留用户已选技术栈，不复刻 Paseo 的daemon 网络发现方式 |
| 任务与会话 | 一个持久工作区可带多个 provider agent session | 工作台 Task 是目标、检查点、授权范围容器；每个执行是独立 Run/AgentSession | 文件 workspace 可以为空，不把所有研究/写作任务变成目录任务 |
| Agent 能力档案 | Profile 带 “when to use” 的协作说明，配置变化用于未来 agent | 将 provider/model/transport/capabilities 与角色说明、强项、限制绑定；任务创建时显示可选 agent 与原因 | 智能选人只提供推荐，用户保留选择；任务启动后记录 profile snapshot |
| 并行研究 | Committee 风格分解成不改文件的独立研究，再统一综合 | 默认先创建只读 analyst assignments，收回精简结构化结论，由 coordinator 合并 | 每个子任务只给必要需求摘要/相关证据/术语表，不广播全上下文 |
| 并行写入 | 独立 worktree 避免并发互相踩工作树 | 代码/目录允许时使用独立 worktree；对共享目录、非代码任务继续使用显式资源锁/按用户授权直接写入 | worktree 是可选隔离，不改变用户选择的任务授权目录，也不是通用任务必需项 |
| 独立审查 | 实现完成后，新的 agent session 根据差异复核 | 在动态任务 DAG 中增加不同 agent/profile 的 review 节点；review 输入优先是 diff、验收标准和实现者声明 | reviewer 尽量不共享实现者的长推理/自评，降低 anchoring；保留问题链接回具体改动 |
| 消息拓扑 | agent 可在工作区/跨 workspace 通过身份发送消息 | 默认由 coordinator 定向派工/传递 handoff packet；任意 agent-peer messaging 不进入首版 | mesh 增加 token、死锁、权限扩散与难调试风险；仅未来显式授权实验 |
| 事件可恢复 | 明确订阅、session/workspace 状态和事件生命周期 | 自有 append-only 任务事件 + 快照/游标；浏览器断线后取缺失事件，不只靠内存事件推送 | 必须核实每个上游 adapter 是否提供可重放历史；无 replay 时明确显示时间线 gap |
| Plugin/扩展 | 插件可扩展 host | 首版以可信、内置 adapter 包为主，用户配置 profile、不开任意代码插件装载 | 外部插件不是安全沙箱；后续另行威胁建模与签名/隔离设计 |
| Protocol contract | SDK/协议层服务 client/daemon 交互 | 内部维护版本化 Shared Task/AgentEvent 契约，adapter 把上游映射到内部事件 | 先用 CLI/ACP 标准或正式 SDK；不绑定不稳定私有 schema |

## 借鉴级别

### 建议纳入后续设计

- `Task / Workspace / AgentSession / RunEvent` 区分；任务代表目标，agent session 代表独立执行上下文。
- Agent Profile 包含“适合何种工作”的简洁说明，以角色/工具/上下文要求解释候选人，而不只提供 provider 下拉框。
- coordinator 按需分派 handoff packet、并行研究后汇总、实施后独立 review；让每个协作动作可以观察、取消、重试或单独复核。
- 代码并发写入提供 worktree 沙箱选项，并把 diff 和测试结果纳入 UI 审查。
- 事件日志可重放，事件订阅具有开始/结束生命周期，并明确断线补读语义。

### 首版不建议照搬

- agent 之间任意 mesh 或无限自由对话；很难限制上下文、结束条件与子任务权限。
- 所有工作都绑定本地 repo/worktree；研究、计划、文案及 DingTalk 等业务流程可能没有代码目录。
- 不经人工配置自动暴露 MCP/工具给任意 provider；工具可见性不等同 OS sandbox。
- 依赖 Paseo 内部 daemon RPC、内部协议 types、UI 实现或私有 API，形成未声明的版本锁定。
- 自动热替换进行中任务的 prompt/adapter：profile/prompt/adapter 必须按任务开始时快照 pin 住；仅经批准后让新任务采用新版本。

## 本项目保留的限制

- 技术方向仍为 React + Vite、Fastify、SQLite，本报告不会改动该选择。
- 默认协作由 coordinator 负责定向传递最小 handoff packet，避免在 agent 之间盲目共享 transcript；拒绝将“看到其他agent所有消息”作为默认行为。
- 文件授权遵循项目 `AGENT.md` 与用户任务批准。是否使用隔离 worktree 需由任务目录和并发冲突决定，而不是因为 Paseo 支持就强制。
- 当前仅研究官网 docs 与官方公开仓库，不复制源代码；如果未来决定复用代码，需单独检查具体 release 的 LICENSE、NOTICE、copyright、依赖与合规策略。
