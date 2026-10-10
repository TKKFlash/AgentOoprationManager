// 替身 codex：读取 stdin 中的提示词，输出与 `codex exec --json` 同形的 JSONL。
// 提示词含 SLEEP 时长时间运行（用于验证取消），含 FAIL 时非零退出（用于验证失败路径）。
// 不访问网络，不调用任何模型。
import { exit, stdin, stdout } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

let input = "";
stdin.setEncoding("utf8");
for await (const chunk of stdin) input += chunk;

const emit = (event) => stdout.write(`${JSON.stringify(event)}\n`);
emit({ type: "thread.started", thread_id: "fake-thread" });
emit({ type: "turn.started" });

if (input.includes("SLEEP")) await delay(10_000);
if (input.includes("FAIL")) exit(2);

emit({
  type: "item.started",
  item: { id: "item_0", type: "command_execution", command: "echo hi", status: "in_progress" },
});
emit({
  type: "item.completed",
  item: { id: "item_0", type: "command_execution", aggregated_output: "TOOL OUTPUT SHOULD NOT LEAK", exit_code: 0, status: "completed" },
});
emit({
  type: "item.completed",
  item: { id: "item_1", type: "agent_message", text: `FAKE: ${input.split("\n")[0]}` },
});
emit({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 3 } });
