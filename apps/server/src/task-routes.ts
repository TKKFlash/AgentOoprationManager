import type { FastifyInstance, FastifyReply } from "fastify";
import {
  BUDGET_LIMITS,
  COLLABORATION_MODES,
  DEFAULT_BUDGET,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  PARTICIPANT_LIMITS,
  TEXT_LIMITS,
} from "@aom/shared";
import { Orchestrator, TaskNotFoundError, TaskStateError } from "./orchestrator.js";
import { InputError, parseNewTask } from "./task-input.js";

interface TaskParams {
  id: string;
}

interface SnapshotQuery {
  afterSeq?: string;
}

/** 增量补读游标：未提供时返回全部事件。 */
function parseAfterSeq(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function registerTaskRoutes(app: FastifyInstance, orchestrator: Orchestrator): void {
  const profiles = orchestrator.listProfiles();
  const knownProfileIds = new Set(profiles.map((profile) => profile.id));

  app.get("/api/profiles", async () => ({
    profiles,
    modes: COLLABORATION_MODES.map((mode) => ({
      id: mode,
      label: MODE_LABELS[mode],
      description: MODE_DESCRIPTIONS[mode],
    })),
    budget: { defaults: DEFAULT_BUDGET, limits: BUDGET_LIMITS },
    participantLimits: PARTICIPANT_LIMITS,
    textLimits: TEXT_LIMITS,
  }));

  app.get("/api/tasks", async () => ({ tasks: orchestrator.listTasks() }));

  app.post("/api/tasks", async (request, reply) => {
    let input;
    try {
      input = parseNewTask(request.body, knownProfileIds);
    } catch (error) {
      if (error instanceof InputError) return reply.code(400).send({ error: error.message });
      throw error;
    }
    const task = orchestrator.createTask(input);
    return reply.code(201).send({ id: task.id, status: task.status });
  });

  app.get<{ Params: TaskParams; Querystring: SnapshotQuery }>("/api/tasks/:id", async (request, reply) => {
    const afterSeq = parseAfterSeq(request.query.afterSeq);
    if (afterSeq === null) return reply.code(400).send({ error: "afterSeq 必须是非负整数" });
    const snapshot = orchestrator.getSnapshot(request.params.id, afterSeq);
    if (!snapshot) return reply.code(404).send({ error: "任务不存在" });
    return snapshot;
  });

  app.post<{ Params: TaskParams }>("/api/tasks/:id/pause", async (request, reply) => {
    return runAction(reply, () => orchestrator.pause(request.params.id), 200);
  });

  app.post<{ Params: TaskParams }>("/api/tasks/:id/resume", async (request, reply) => {
    return runAction(reply, () => orchestrator.resume(request.params.id), 200);
  });

  app.post<{ Params: TaskParams }>("/api/tasks/:id/cancel", async (request, reply) => {
    return runAction(reply, () => orchestrator.cancel(request.params.id), 202);
  });
}

async function runAction(
  reply: FastifyReply,
  action: () => { id: string; status: string },
  successCode: number,
): Promise<FastifyReply> {
  try {
    const task = action();
    return reply.code(successCode).send({ id: task.id, status: task.status });
  } catch (error) {
    if (error instanceof TaskNotFoundError) return reply.code(404).send({ error: "任务不存在" });
    if (error instanceof TaskStateError) return reply.code(409).send({ error: error.message });
    throw error;
  }
}
