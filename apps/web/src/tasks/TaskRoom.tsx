import { useEffect, useState } from "react";
import { MODE_LABELS, type Step, type TaskSnapshot } from "@aom/shared";
import { api } from "../api.js";
import {
  StatusChip,
  StepChip,
  TERMINAL_STATUSES,
  errorMessage,
  formatDuration,
  formatTime,
  stepLabel,
  stepTone,
} from "./common.js";

/** 合并增量快照：首次或全量读取时整体替换；增量时只追加新的事件。 */
function mergeSnapshot(previous: TaskSnapshot | null, next: TaskSnapshot, requestedCursor: number): TaskSnapshot {
  if (!previous || requestedCursor === 0) return next;
  const known = new Set(previous.events.map((event) => event.seq));
  return { ...next, events: [...previous.events, ...next.events.filter((event) => !known.has(event.seq))] };
}

/**
 * 按 seq 游标轮询任务快照。刷新页面时游标从 0 开始，因此总能恢复已保存的完整状态。
 * 任务进入终态后停止轮询。
 */
function useTaskSnapshot(taskId: string): { snapshot: TaskSnapshot | null; error: string | null } {
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let cursor = 0;

    const tick = async (): Promise<void> => {
      const requested = cursor;
      try {
        const next = await api.snapshot(taskId, requested);
        if (!active) return;
        setError(null);
        setSnapshot((previous) => mergeSnapshot(previous, next, requested));
        cursor = next.events.reduce((max, event) => Math.max(max, event.seq), cursor);
        if (!TERMINAL_STATUSES.includes(next.task.status)) {
          timer = window.setTimeout(() => void tick(), 1_200);
        }
      } catch (cause) {
        if (!active) return;
        setError(errorMessage(cause));
        timer = window.setTimeout(() => void tick(), 3_000);
      }
    };

    void tick();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [taskId]);

  return { snapshot, error };
}

export function TaskRoom({ taskId }: { taskId: string }) {
  const { snapshot, error } = useTaskSnapshot(taskId);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!snapshot) {
    return (
      <section className="task-panel">
        <a className="back" href="#tasks">← 任务空间</a>
        {error
          ? <div className="notice" role="status">{error}。页面会自动重试。</div>
          : <p className="muted">正在读取任务…</p>}
      </section>
    );
  }

  const { task, steps, artifacts, events, participants } = snapshot;
  const nameOf = new Map(participants.map((profile) => [profile.id, profile.name]));
  const finished = TERMINAL_STATUSES.includes(task.status);
  const ordered: Step[] = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  const speaking = ordered.some((step) => step.status === "running");

  async function act(action: (id: string) => Promise<unknown>): Promise<void> {
    setActing(true);
    setActionError(null);
    try {
      await action(taskId);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setActing(false);
    }
  }

  return (
    <section className="task-room">
      <header className="room-head">
        <a className="back" href="#tasks">← 任务空间</a>
        <h1>{task.goal}</h1>
        <div className="room-chips">
          <span className="chip tone-idle">{MODE_LABELS[task.mode]}</span>
          <StatusChip status={task.status} />
          {task.degraded && <span className="chip tone-warn">结论不完整</span>}
          <span className="meta">调用 {task.callsUsed}/{task.budget.maxTotalCalls}</span>
          <span className="meta">创建于 {formatTime(task.createdAt)}</span>
        </div>
        {task.acceptanceCriteria.length > 0 && (
          <ul className="criteria">
            {task.acceptanceCriteria.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
      </header>

      <div className="room-controls">
        {task.status === "running" && (
          <button type="button" className="ghost" disabled={acting} onClick={() => void act(api.pause)}>暂停</button>
        )}
        {task.status === "paused" && (
          <button type="button" className="primary-button" disabled={acting} onClick={() => void act(api.resume)}>继续</button>
        )}
        {(task.status === "running" || task.status === "paused") && (
          <button type="button" className="danger" disabled={acting} onClick={() => void act(api.cancel)}>取消任务</button>
        )}
        {task.status === "paused" && <span className="hint">已暂停：正在进行的调用结束后，不再开始新步骤。</span>}
        {task.status === "running" && <span className="hint">进度自动同步；刷新页面不会中断任务。</span>}
        {actionError && <span className="error" role="alert">{actionError}</span>}
      </div>

      {finished && task.stopReason && task.status !== "completed" && (
        <div className="notice" role="status">{task.stopReason}</div>
      )}

      <ul className="roster" aria-label="参与者状态">
        {participants.map((profile, index) => {
          const latest = [...ordered].reverse().find((step) => step.participantId === profile.id && step.status !== "pending");
          return (
            <li key={profile.id} className="roster-item">
              <div className="roster-name">
                <strong>{profile.name}</strong>
                {index === 0 && <span className="badge">{task.mode === "coordinator" ? "协调者" : "主持收敛"}</span>}
              </div>
              <small className="muted">{latest ? latest.title : "等待中"}</small>
              {latest && <StepChip status={latest.status} />}
            </li>
          );
        })}
      </ul>

      <div className="room-grid">
        <section className="panel" aria-label="讨论室">
          <h2>讨论室</h2>
          {ordered.every((step) => step.status === "pending") && <p className="muted">任务尚未开始发言。</p>}
          {ordered.map((step) => {
            const speaker = nameOf.get(step.participantId) ?? "参与者";
            const duration = formatDuration(step.durationMs);
            if (step.output) {
              return (
                <article key={step.id} className="bubble">
                  <header>
                    <strong>{speaker}</strong>
                    <span className="meta">{step.title}</span>
                    {duration && <span className="meta">{duration}</span>}
                  </header>
                  <pre>{step.output}</pre>
                </article>
              );
            }
            if (step.status === "running") return <p key={step.id} className="typing">{speaker} 正在发言…</p>;
            if (step.status !== "pending" && step.note) {
              return (
                <p key={step.id} className={`system-note tone-${stepTone(step.status)}`}>
                  {speaker}「{step.title}」{stepLabel(step.status)}：{step.note}
                </p>
              );
            }
            return null;
          })}
          {speaking && <p className="meta">正在等待当前调用返回…</p>}
        </section>

        <section className="panel" aria-label="动态步骤">
          <h2>动态步骤</h2>
          <ol className="steps">
            {ordered.map((step) => (
              <li key={step.id} className={`step tone-${stepTone(step.status)}`}>
                <div className="step-head">
                  <span className="ordinal">{step.ordinal + 1}</span>
                  <strong>{step.title}</strong>
                  <StepChip status={step.status} />
                </div>
                <div className="step-meta">
                  {nameOf.get(step.participantId) ?? "参与者"}
                  {step.round ? ` · 第 ${step.round} 轮` : ""}
                  {formatDuration(step.durationMs) ? ` · ${formatDuration(step.durationMs)}` : ""}
                </div>
                {step.inputSummary && <p className="step-input">{step.inputSummary}</p>}
                {step.note && <p className="step-note">{step.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="panel" aria-label="产物">
        <h2>产物</h2>
        {artifacts.length === 0 && (
          <p className="muted">{finished ? "本任务未产生最终结论。" : "最终结论将在综合完成后出现在这里。"}</p>
        )}
        {artifacts.map((artifact) => (
          <article key={artifact.id} className="artifact">
            <header>
              <strong>{artifact.title}</strong>
              <span className="meta">{formatTime(artifact.createdAt)}</span>
            </header>
            <pre>{artifact.body}</pre>
          </article>
        ))}
      </section>

      <details className="panel events">
        <summary>事件日志（{events.length}）</summary>
        <ol>
          {events.map((event) => (
            <li key={event.seq}>
              <span className="meta">#{event.seq}</span>
              <time className="meta">{formatTime(event.at)}</time>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
