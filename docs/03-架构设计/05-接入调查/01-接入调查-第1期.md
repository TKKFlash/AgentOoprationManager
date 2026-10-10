# 第 1 期：智能体接入与权限调查

**调查日期：**2026-10-09  
**范围：**只读环境与文档调查；未发起任何模型任务，未安装/更新程序，未更改 agent、服务、凭据、profile 或工作区配置。  
**状态口径：**“已验证”表示本机只读观察或检查到指定的本地实现事实，不表示安全审计完成或已做真实任务端到端试跑。

## 结论摘要

1. 本机已观察到 Codex CLI、Hermes 中文桌面运行时和 DSH 工作区/源码。三者都提供非交互或程序化接入路径；不能将各产品的 Web UI 地址统一当成 agent RPC。
2. **DSH 当前 `127.0.0.1:3080` 是浏览器 Web 前端端口，不是已经确认的 agent API。** 本机监听进程链包括 `pnpm dsh web`；HTTP 根路径返回 401，HTTPS 不可用。当前本机 DSH profile 配置端口为 3080 且绑定回环；本机同版本源码说明 /api 另有浏览器登录时使用的启动令牌换取 authority-bound Cookie、Host/Origin 与 DNS-rebinding 防护机制；本机 401 与该机制相符。未带用户主动授权的认证凭据做 API 实测，因此不能据此证明当前进程配置的具体鉴权状态。切勿从工作台直接读取 UI 的认证 Cookie/进程令牌，也不能把这些内部 HTTP/RPC 路由假设为稳定外部 API。
3. Codex 与 DSH 都有本机可用的结构化非交互输出。Codex `exec --json` 输出 JSONL，且 app-server 可用 stdio，但 app-server 命令自身标为 experimental；首期不据此承诺使用其 wire 协议。能力与状态依据本机 `codex --help`、`codex exec --help`、`codex app-server --help`（codex-cli 0.155.1）只读检查；官方入口见 [Codex CLI](https://developers.openai.com/codex/cli) 与 [Codex app-server](https://developers.openai.com/codex/app-server)。
4. 本机 Hermes 最可复现的调用途径是 `hermes -z/--oneshot`，但它会自动绕过审批，不能作为安全隔离的交互运行模式直接使用。Hermes 同时公开 ACP、TUI gateway JSON-RPC、OpenAI-compatible HTTP+SSE 接入方向；本机 `hermes acp --check` 明确失败（缺少 ACP 依赖），故 ACP 当前不可运行；本机 API Server 是否配置和启用也未验证。
5. DSH 的 headless 会把一项任务的 JSONL/最终答案输出后退出，适合短任务与只读分析。需要多会话、取消、语义事件和权限交互时，其 ACP profile 更贴合目的；但当前已安装 ACP profile 依赖尚未安装，暂不能实用验证。源码声明的 ACP 接口对控制器是可信边界：`authenticate` 不要求认证，所以只能由本机受信控制器通过 stdio 启动/管理，不能暴露成无认证网络服务。
6. 当前不为 AgentOoprationManager 选择单一最终协议。本机确认 DSH Web/ACP 均需要“能否以不安装依赖的方式使用”的后续决定；推荐底座优先以子进程/stdio 的 CLI 或 ACP adapter 作为边界，Web UI 仅作为人类入口而非 agent 后端。

## 本机检查结果

| 组件 | 可见安装/版本 | 本次无写入检查 | 结论 |
|---|---|---|---|
| Codex | `codex-cli 0.155.1`；`codex login status` 报告已认证（未输出任何凭据） | `codex exec --help`、`codex app-server --help` | 存在非交互执行及 app-server；本期未发送任务或启动会话 |
| Hermes CN | Hermes Agent `0.21.0-cn.18`，runtime 来源仓库 `Eynzof/Hermes-CN-Core`；桌面进程正在运行 | CLI `--help`、`acp --check`、`serve --status`、已有 dashboard 的 HTTP status | one-shot 可选；ACP extra 未装。本机端口 9120 是 Hermes dashboard/API 进程线索之一，不能据此判定 API 已配置。检查运行端点仅记录 HTTP 状态，不读取响应体、Cookie 或 token |
| DSH Web | 本机源码版本 `0.1.6-alpha.2`，commit `ddefc45fbc7f8e46dd73185e68295696d1297887`；本机 CLI `dws` 是另一程序，**不等同 DSH agent** | 3080 监听者命令链为 `pnpm dsh web`；HTTP `/` 返回 401；profile 配置显示 `host=127.0.0.1`、`port=3080` | 验证这是人类 Web 服务地址，不是已确认的 programmatic agent endpoint |
| DSH CLI | 与上列源码相同版本；已安装 `headless`、`web` profile；ACP profile 声明为 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-acp-app`，但该 profile 无 `node_modules` | `dsh --version`、headless/acp/web `--help`、仅读源码与 profile 清单 | headless 输出可机器消费；ACP 将按不可信网络服务对待；未启动 task、未补装 profile |
| DSH 本机仓库状态 | `D:\software\deepseek-harness` | 仅读取 Git revision/status | 工作树原先就有未跟踪 `barecheck.tmp.mjs`；未查看、覆盖、清理或触碰该文件 |

## 能力矩阵

| 接入候选 | 协议 / 会话 | 结构化流与进度 | 取消 | 工作区与写入权限 | 鉴权及限制 | 本期结论 |
|---|---|---|---|---|---|---|
| **Codex CLI `exec`** | 本机子进程；stdio/stdin 提示词；单次执行，可显式 worktree | `--json` 输出 JSONL（本机帮助文档事实）；具体 event taxonomy 需按当前版本进一步核对 | 子进程终止可请求停止，但是否能安全/一致中止所有底层工具须实测 | 可指定 `-C`、`--add-dir`、`--worktree`；支持 `read-only` / `workspace-write` / `danger-full-access` sandbox flags。沙箱是否 enforced 及 Windows 的实际范围需测试；不能与工作台审批模型等同 | 复用已登录 Codex 凭据；不读取 `auth.json` 等 secret 文件。`--dangerously-bypass-approvals-and-sandbox` 严禁用作默认 | **适合作为第一候选 CLI adapter；启动时默认只读，兼容能力尚未实跑** |
| **Codex app-server** | 子进程 stdio（默认），也有 Unix/socket/WebSocket transport 选项；持续 server/client protocol | richer thread/turn/item notifications 候选 | 以协议方法处理；要核对版本对应请求与取消语义 | 继承 Codex 权限配置和 thread 行为，不自动构成更窄权限边界 | CLI 把 app-server 标为 experimental；Codex 本地/官方 wire bindings 有版本演进风险 | **不作为首版默认，待 CLI adapter 成熟后再比较** |
| **Hermes `-z` / CLI one-shot** | 本机子进程；单次任务，一次 run 结束输出结果 | `-z` 输出最终文本并可 `--usage-file` 保存 token/cost/API 调用 JSON；CLI bot mode 另可用 `--format stream-json` | 进程终止不等于模型工具能干净回滚；具体中止/落库行为待验证 | 会加载 Hermes tools、memory、rules、`AGENTS.md`；支持指定目录、worktree 和 toolsets。关键限制：one-shot **自动跳过交互审批** | 使用 Hermes profile/provider 凭据；本机无 ACP extra。不得传入 `--yolo`、`--accept-hooks`；不能把自动审批包装成外层 UI 审批 | **适合经限定输入和工具策略后的只读/建议型短调用；有写操作风险时先禁用工具或暂不启用** |
| **Hermes ACP** | stdio JSON-RPC，支持持久 session | prompt chunks、tool-call events、permission requests | ACP cancel | 可有工作目录/工具，但授权由客户端与 Hermes approval bridge 联合实现 | 当前 `hermes acp --check` = 缺少 ACP dependencies（exit 1）；尚未运行 | **接口特征适合会话型 adapter，但本机不可用，不能视为已接入** |
| **Hermes TUI gateway** | JSON-RPC over stdio；可选 WebSocket | session 事件与服务端请求，可传递 approval/clarify 等 | gateway control candidate；细节需按版本验证 | 具备完整交互与工具请求，不能只凭会话鉴权替代工具授权 | gateway 认证和持久运行设置待本地核验；没有配置/暴露此服务 | **可作为 ACP 不可用时的替代研究候选，非当前实施决定** |
| **Hermes API Server** | OpenAI-compatible HTTP；streaming 可用 SSE；另有 runs API | token usage、运行状态/事件、工具事件、持久 run 和审批 API 能力见官方文档 | 官方 API 提供 stop run；须核对应用版本与配置 | full access to Hermes toolset（含 terminal）意味着这不是天然只读 endpoint；运行可等待审批 | 官方要求每次部署都设置 `API_SERVER_KEY`，包括 loopback；默认关闭 API server，CORS 默认关闭。本机没有确认 API 配置或访问权限 | **适合未来单独显式启用并经审查的 API adapter；不要代理现有 dashboard 到 browser** |
| **DSH headless** | 一次任务启动一次本机子进程；stdin 或 prompt 参数；可采用持久 session ID | `--json` 输出 newline-delimited run events，stdout 可作为可机读通道，stderr 为诊断 | CLI 进程结束时会话清理可行，但可靠工具级取消与跨进程 resume 需单独验证 | DSH base 仅给 subprocess 文件效果模式 read-only/workspace-write/danger-full-access。当前 mode 默认 `workspace-write`，approval 默认 `ask`；`danger-full-access` 的 approval=`never`。本期不得沿用该默认作为产品安全保证 | 本机 DSH headless profile 已装；读取源码、命令 help 与 profile 配置，不执行模型请求 | **有强实用性的首批短任务 adapter 候选；启动时必须覆盖为工作台受控的只读/请求批准策略** |
| **DSH ACP** | JSON-RPC over stdio；每连接多持久 session | 标准 ACP session updates（消息、thoughts、工具生命周期、配置、context usage），顺序化 | `session/cancel` / `$/cancel_request`，`session/close` 清理指定 agent scope | 一个 primary workspace；支持 session/prompt 与 permission request；resource/MCP 有受限支持；trusted client 可配置连接工具 | DSH ACP `authenticate` immediate success、无 transport auth；因此禁止网络暴露，只能由本机受信控制器管理 stdio 子进程。profile 尚缺 node_modules | **最符合多 session 追踪；前提是用 OS/process 管控和工作台端验证建立本机信任边界，不原样继承 trusted controller 全部权限** |
| **DSH Web `127.0.0.1:3080`** | Browser UI + 内部 `/api`/Remote WebSocket，面向人类客户端 | 有浏览器事件/远程调用能力 | UI/Agent 控制行为依赖私有接口，未保证向外部协调器提供稳定 contract | Web UI 上 Agent 拥有其 profile/composed tools 的权限；loopback 不会缩小 tool scope | 本机观测认证根路径 401；同版本源码揭示随机 launch token、绑定 authority 的签名 cookie、Host/Origin 信任检查。Webserver 原始 service 本身不带 TLS/auth/origin policy；认证/信任由上层 connection 组合实现 | **不能作为 Agent API；不得从浏览器/进程导出会话凭据，亦不建议直接复用私有 `/api`** |

### 权限结论

- UI/CORS/localhost 限制不是执行沙箱。每个 agent adapter 都必须从服务端选择运行策略、可执行命令、cwd/路径和工具集合，并记录实际生效配置。
- 首次集成阶段选择只读 profile/模式；写入能力进入第 6 期且需用户逐任务明确授权。对 DSH，应在创建 subprocess/profile 时明确用 `read-only`/`workspace-write` 模式与 ask gate 的组合；不能把 `dsh headless` 的默认 `workspace-write` 当成无写入能力。
- Hermes `-z` 会 bypass approvals 是决定接入方式的硬限制：后续若调用，只能在无写操作工具的 profile/toolset 或等价且已实测的策略下先作为 read-only researcher。不能声称“用户可在外层审批”就恢复内部审批语义。
- DSH ACP 文档将 controller 称为 trusted client，且 wire `authenticate` 不做认证。仅通过 stdio 创建子进程能限缩 transport 暴露，但仍要严格限制随 ACP `session/new` 配置的 workspace、MCP server、命令和环境，不允许不受控客户端自行指定。
- DSH Web 的 3080 服务带浏览器认证，不等于可安全地向另一网页反向代理；如果后续仍要集成，须先取得并验证公开 RPC/SDK contract，并避免复用用户现存 browser cookie/session。
- 检查期间只访问本机 `127.0.0.1` 确认 `/` 与 `/health` 的状态码，不读取响应正文/敏感头，也未对网关 API 发起调用。

## 建议的工作台适配器边界（待第 2/3 期批准）

- 使用**子进程 stdio + 显式宿主权限策略**作为首批通用启动 seam，CLI 非交互模式优先，面向长会话的 ACP provider 单独实现；不要把所有 provider 统一伪装成 OpenAI Chat Completions。
- 能力声明至少需要覆盖：`transport`、`supportsStreaming`、`supportsPersistentSession`、`supportsCancel`、`supportsWorkingDirectory`、`supportsSandboxModes`、`requiresApprovalBridge`、`requiresInstalledOptionalDependencies`、`trustedControllerOnly`。
- 连接检测只能使用版本、profile/运行器可用性和无写入帮助命令；不得启动一次“探活 prompt”因为它会真实调用模型并消耗费用。
- Web/API connector 若不是本机子进程所有，应要求显式端点、认证配置、允许动作和确认回调；禁止从现存浏览器、环境变量全量转储或凭据文件自动窃取密钥。
- 所有协议事件统一投影为工作台自己的任务/参与者事件契约；保留上游原始事件存储位置和版本标签，不能把上游内部 wire schema 直接当数据库公共 API。

## 证据与复现位置

### Codex

- 本机 `codex --version`：`codex-cli 0.155.1`。
- 本机 `codex exec --help` 明示非交互执行、JSONL、worktree、cwd、sandbox 模式、ephemeral 输出与 schema 限制。
- 本机 `codex app-server --help` 标记 experimental，stdio 默认、另含 Unix/WS/关闭选项。
- 本机 `codex login status` 仅报告已认证；未读取账号、token 或账单信息。
- 官方文档入口：`https://developers.openai.com/codex/cli`、`https://developers.openai.com/codex/app-server`。本期没有发送 prompt、生成调用事件或验证实际 JSONL schema。

### Hermes

- 本机应用安装目录：`D:\software\Hermes Agent CN Desktop`；确切运行时 `D:\software\Hermes Agent CN Desktop\data\versions\0.21.0-cn.18\hermes-agent-cn-runtime-win32-x64.exe`。
- Runtime package metadata identifies `Eynzof/Hermes-CN-Core` tag `runtime-v0.21.0-cn.18` / commit `b9f82a21fd9268bd499051e23b614ecb06d5b888`；版本 `0.21.0-cn.18`。
- 只运行 `--help` 与 `acp --check`；不读取 Hermes home 的 `.env`、`auth.json`、provider 配置密钥或 SOUL 全文。
- 官方协议比较：`https://hermesagent.nousresearch.com/docs/developer-guide/programmatic-integration`；[ACP](https://hermesagent.nousresearch.com/docs/user-guide/features/acp)；[API Server](https://hermesagent.nousresearch.com/docs/user-guide/features/api-server)；[CLI reference](https://hermesagent.nousresearch.com/docs/reference/cli-commands)。

### DSH

- 本机源码副本：`D:\software\deepseek-harness`；version `0.1.6-alpha.2`、commit `ddefc45fbc7f8e46dd73185e68295696d1297887`、MIT。无修改工作树状态为 `?? barecheck.tmp.mjs`；保持原样。
- 证据文件：`apps/cli/src/args.ts`、`apps/cli/config` profile templates、`packages/bundle/base/cordis.patch.yml`、`packages/acp/acp/README.md`、`packages/host/webserver/README.md`、`packages/client/connection/README.md`、`packages/sandbox/README.md`、`docs/architecture.md`。
- 对应官方仓库：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[ACP package](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp)。

### Hermes 官方材料追加记录

官方 integration 页面将 ACP (stdio JSON-RPC)、TUI gateway (stdio/WebSocket JSON-RPC) 和 API Server (HTTP + SSE) 明确分成三条路径；API Server 默认关闭，loopback 部署也必须配置 `API_SERVER_KEY`。其能力远超过纯 completion，包含 persistent run/events、steer/stop 与 approvals；同时 API Server 可使用完整 Hermes toolset（含 terminal），须将其视作有执行权限的 agent host，而非单纯模型端点。见 [Programmatic Integration](https://hermesagent.nousresearch.com/docs/developer-guide/programmatic-integration) 与 [API Server](https://hermesagent.nousresearch.com/docs/user-guide/features/api-server)。
