# 参考资料：Paseo agent 工作台

**来源项目：** [getpaseo/paseo](https://github.com/getpaseo/paseo)  
**研究日期：** 2026-10-09  
**用途：** 为 AgentOoprationManager 提供可追溯的 agent 协作与软件架构参考；不是直接照搬其实现的决定。

## 核心观察与本项目可借鉴点

1. **客户端与本机宿主分离。** Paseo 的 daemon 统一管理 agent，客户端通过公开 SDK 与其通信；monorepo 将 app、server、client、protocol、CLI、plugin 等职责分开。适合本项目后续将 Fastify 定位为本机任务/agent 宿主、网页定位为客户端，同时维护自己的稳定共享接口。来源：[README](https://github.com/getpaseo/paseo/blob/main/README.md)、[workspace package.json](https://github.com/getpaseo/paseo/blob/main/package.json)、[client SDK](https://github.com/getpaseo/paseo/tree/main/packages/client)。
2. **Provider 作为接入边界。** Provider 表达如何启动 agent、向运行会话送入输入、流式发布标准事件及能力；Paseo 兼有原生适配器和 ACP 通用适配器。适合借鉴“核心编排不直接调用厂商细节”的原则；首期是否采用 ACP 或哪些 native adapter 仍待实测。来源：[Providers](https://paseo.sh/docs/providers)、[Provider plugin guide](https://paseo.sh/docs/plugins/providers)。
3. **角色 Profile 与未来任务配置。** profile 将 provider、model、mode 等配置同“何时使用”的角色说明打包；修改 profile 影响未来新建的 agent，而不是已经启动的 agent。可借鉴为可配置参与者/角色及任务启动时配置快照。来源：[Agent profiles](https://paseo.sh/docs/agent-profiles)。
4. **稳定工作区内管理多个运行会话。** Paseo 区分 workspace（任务工作的稳定容器）与其中的 agent session；同一 workspace 可查看多个 agent、terminal、browser 和 diff。这与本项目的任务视图、参与者讨论、动态步骤和执行结果可追踪目标吻合。来源：[Workspaces](https://paseo.sh/docs/workspaces)。
5. **成熟的协作工作流，而非把所有 agent 扔进一间群聊。** 文档给出独立研究后合并、handoff 精简任务简报、committee 只做分析、advisor 给第二意见、实施后由独立 agent 复核等流程。适合用于内置提示词/工作流：传递目标、状态、相关证据、决策、约束与验收，而不是全量历史。来源：[Orchestration skills](https://paseo.sh/docs/skills)、[Common workflows](https://paseo.sh/docs/orchestration-workflows)。
6. **代码并行隔离与差异审阅。** 对并行代码任务，Paseo 可为每项工作建立独立 Git worktree，并在合并前查看各自 diff 与测试结果。可作为受授权代码任务的隔离选项；不应覆盖用户关于任务级授权目录内执行的选择，也不适用于所有非代码任务。来源：[Run parallel tasks](https://paseo.sh/docs/parallel-development)、[Git worktrees](https://paseo.sh/docs/worktrees)。
7. **事件时间线需要生命周期设计。** SDK 文档示例使用 snapshot + update 订阅、明确释放订阅并在断线后处理恢复/历史补取。建议我们建立自己的可持久事件模型、初始快照与重连策略，以支持网页实时进度和审计。来源：[SDK events](https://paseo.sh/docs/sdk/events)。

## 风险与不应照搬之处

- Paseo 的 MCP/provider capabilities policy 用于控制 agent 可见的工具目录，但其文档明确指出 plugin 代码受信任且运行时可访问宿主机器。隐藏工具或安装插件不等于系统级沙箱；本项目的路径授权和操作审批必须由服务端强制执行。来源：[MCP reference](https://paseo.sh/docs/mcp)、[Plugin reference](https://paseo.sh/docs/plugins/reference)。
- Paseo 的 protocol package README 说明其 schema、wire helpers 和类型当前不是稳定公共 API。本项目应优先维护自己的共享契约，不直接依赖上游内部 schema；若将来集成任何公开 SDK，须先确认版本兼容和具体授权。来源：[Paseo protocol package](https://github.com/getpaseo/paseo/blob/main/packages/protocol/README.md)、[client SDK stability](https://github.com/getpaseo/paseo/blob/main/packages/client/README.md)。
- Paseo 以 coding workspace 和 CLI agent 为主要领域；本项目目标涵盖研究、写作、开发及业务任务，应借用抽象边界和协作模式，而不是把文件树、Git 分支或代码 diff 强加给每种任务。
- 该仓库和在线文档会随版本演进；具体接入/代码借用前要对照当时对应的发行版本和文件许可证。本阶段只研究公开文档与架构，不复制其源代码。

## 项目内映射

- [`ARCHITECTURE.md`](ARCHITECTURE.md)：Paseo 分层及对当前目标技术栈的映射。
- [`ROADMAP.md`](ROADMAP.md)：将案例审查加入待用户批准的第 1 期。
- [`DECISIONS.md`](DECISIONS.md)：区分用户确认“作为参考”和 AI 建议“可借鉴但尚未批准”。