# 多智能体协作工作台

## 项目目标

建设一个面向个人本机使用的网页工作台，让用户发布通用需求，并按任务选择可配置的智能体参与讨论和分工。工作台旨在通过清晰的任务拆解、过程可视化、交叉检查和精选共享记忆，提高任务质量与完成效率，同时避免向每个智能体无差别传递完整上下文。

## 产品方向

- 采用本机网页与本机服务，首版面向单用户。
- 通过可扩展适配器接入智能体；Codex、Hermes、DSH 是候选对象，不把固定品牌写死在协作核心。
- 支持“协调者分工”和“多轮讨论”，并以讨论与动态步骤状态跟踪过程。
- 默认只分享完成子任务所需的结构化简报和证据，不广播全部对话历史；跨任务记忆方向为按需检索并遵循 Flash Vault 规则。
- 目标技术组合为 React + Vite、TypeScript、Fastify 与 SQLite。

## 当前状态（2026-10-10）

**第 0 期和第 1 期已完成；第 2 期尚未获批。** 当前交付包含目录骨架、项目规则和 Markdown 研究/架构文档；未创建应用代码、依赖配置，也未安装依赖。工作台不可运行。

第 1 期的本机只读调查发现：Codex CLI 和 DSH Headless 是可评估的结构化 CLI 接入候选；Hermes 有 one-shot、ACP、gateway 和 HTTP API 等不同路径，但 one-shot 会绕过内部交互审批；DSH 的 `127.0.0.1:3080` 是 Web UI，不是已确认的 Agent API。具体证据和权限限制见 [`docs/INTEGRATION-RESEARCH.md`](docs/INTEGRATION-RESEARCH.md)。Paseo 架构及协作方式对照见 [`docs/PASEO-COMPARISON.md`](docs/PASEO-COMPARISON.md)。这些是调查结论和建议，尚未批准实施连接器。

Jet / RelayBoard 的视觉参考截图或网址，以及实际提示词包来源目录尚待提供。

## 分期协作

每期开始前确认范围和验收标准；完成后汇报交付物、验证结果和未决风险，并停止等待用户明确批准下一期。阶段路线与审批门槛见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 目录导航

- `apps/web/`：计划中的网页前端
- `apps/server/`：计划中的本机服务
- `packages/shared/`：计划中的前后端共享契约
- `packages/agent-adapters/`：计划中的智能体适配器
- `prompts/`：计划中的系统与角色提示词
- `tests/`：计划中的测试
- `docs/`：阶段、架构、决策、调查与参考项目对照
- `AGENTS.md`：唯一权威项目级智能体约束

## 参考项目

用户指定 [Paseo](https://github.com/getpaseo/paseo) 作为 agent 协作方式和代码架构参考。当前仅借鉴公开架构思路和工作流；没有复制代码、添加 Paseo 依赖，亦未改变已选技术栈。对照分析见 [`docs/PASEO-COMPARISON.md`](docs/PASEO-COMPARISON.md)。
