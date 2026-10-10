import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  BUDGET_LIMITS,
  COLLABORATION_MODES,
  DEFAULT_BUDGET,
  PARTICIPANT_LIMITS,
  TEXT_LIMITS,
  type CallBudget,
  type CollaborationMode,
} from "@aom/shared";
import type { NewTask } from "./orchestrator.js";

/** 用户输入不合法；消息可直接展示给用户。 */
export class InputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 文本校验。超长直接拒绝而不是静默截断，避免用户以为提交的内容已被完整保存。
 */
function requireText(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== "string") throw new InputError(`${label}必须是文本`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new InputError(`请填写${label}`);
  if (trimmed.length > maxLength) throw new InputError(`${label}不能超过 ${maxLength} 个字符`);
  return trimmed;
}

function integerIn(
  value: unknown,
  fallback: number,
  limits: { readonly min: number; readonly max: number },
  label: string,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < limits.min || value > limits.max) {
    throw new InputError(`${label}需为 ${limits.min} 到 ${limits.max} 之间的整数`);
  }
  return value;
}

function parseBudget(raw: unknown): CallBudget {
  if (raw === undefined || raw === null) return { ...DEFAULT_BUDGET };
  if (!isRecord(raw)) throw new InputError("预算设置格式无效");
  return {
    maxTotalCalls: integerIn(raw.maxTotalCalls, DEFAULT_BUDGET.maxTotalCalls, BUDGET_LIMITS.maxTotalCalls, "调用次数上限"),
    maxRounds: integerIn(raw.maxRounds, DEFAULT_BUDGET.maxRounds, BUDGET_LIMITS.maxRounds, "讨论轮数"),
    perCallTimeoutMs: integerIn(
      raw.perCallTimeoutMs,
      DEFAULT_BUDGET.perCallTimeoutMs,
      BUDGET_LIMITS.perCallTimeoutMs,
      "单次调用超时（毫秒）",
    ),
  };
}

function parseWorkingDirectory(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new InputError("工作目录必须是文本");
  const trimmed = raw.trim();
  if (!isAbsolute(trimmed)) throw new InputError("工作目录必须是绝对路径");
  let isDirectory = false;
  try {
    isDirectory = statSync(trimmed, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new InputError("工作目录不存在，或不是文件夹");
  return trimmed;
}

/**
 * 校验并规范化新建任务的请求体。
 */
export function parseNewTask(body: unknown, knownProfileIds: ReadonlySet<string>): NewTask {
  if (!isRecord(body)) throw new InputError("请求内容必须是 JSON 对象");

  const goal = requireText(body.goal, TEXT_LIMITS.goal, "任务目标");

  const rawCriteria = body.acceptanceCriteria ?? [];
  if (!Array.isArray(rawCriteria)) throw new InputError("验收标准必须是列表");
  if (rawCriteria.length > TEXT_LIMITS.acceptanceCriteria) {
    throw new InputError(`验收标准最多 ${TEXT_LIMITS.acceptanceCriteria} 条`);
  }
  const acceptanceCriteria = rawCriteria
    .filter((item) => typeof item !== "string" || item.trim().length > 0)
    .map((item) => requireText(item, TEXT_LIMITS.acceptanceCriterion, "验收标准"));

  const mode = body.mode;
  if (typeof mode !== "string" || !(COLLABORATION_MODES as readonly string[]).includes(mode)) {
    throw new InputError("协作模式无效");
  }

  const rawParticipants = body.participantIds;
  if (!Array.isArray(rawParticipants) || !rawParticipants.every((id) => typeof id === "string")) {
    throw new InputError("参与者列表格式无效");
  }
  const participantIds = rawParticipants as string[];
  if (participantIds.length < PARTICIPANT_LIMITS.min || participantIds.length > PARTICIPANT_LIMITS.max) {
    throw new InputError(`请选择 ${PARTICIPANT_LIMITS.min} 到 ${PARTICIPANT_LIMITS.max} 位参与者`);
  }
  if (new Set(participantIds).size !== participantIds.length) {
    throw new InputError("同一参与者不能重复选择");
  }
  if (participantIds.some((id) => !knownProfileIds.has(id))) {
    throw new InputError("包含未知的参与者");
  }

  return {
    goal,
    acceptanceCriteria,
    mode: mode as CollaborationMode,
    participantIds,
    budget: parseBudget(body.budget),
    workingDirectory: parseWorkingDirectory(body.workingDirectory),
  };
}
