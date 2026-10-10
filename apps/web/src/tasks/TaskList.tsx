import { useEffect, useState } from "react";
import { MODE_LABELS, type TaskSummary } from "@aom/shared";
import { api } from "../api.js";
import { StatusChip, errorMessage, formatTime } from "./common.js";

export function TaskList() {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const response = await api.listTasks();
        if (!active) return;
        setTasks(response.tasks);
        setError(null);
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="task-panel">
      <div className="task-panel-head">
        <div>
          <h1>任务空间</h1>
          <p>每个任务在创建时固定参与者、协作方式与调用预算；过程与结论保存在本机。</p>
        </div>
        <a className="primary-button" href="#tasks/new">新建任务</a>
      </div>

      {error && <div className="notice" role="status">{error}。页面会自动重试。</div>}
      {tasks === null && !error && <p className="muted">正在读取任务…</p>}
      {tasks?.length === 0 && (
        <div className="empty">
          <strong>还没有任务</strong>
          <p>新建一个任务，选择参与者与协作方式开始。默认参与者为模拟参与者，不调用任何模型。</p>
        </div>
      )}

      <ul className="task-list">
        {tasks?.map((task) => (
          <li key={task.id}>
            <a className="task-row" href={`#tasks/${encodeURIComponent(task.id)}`}>
              <div className="task-row-main">
                <strong>{task.goal}</strong>
                <span className="meta">{MODE_LABELS[task.mode]} · 创建于 {formatTime(task.createdAt)}</span>
              </div>
              <div className="task-row-meta">
                <StatusChip status={task.status} />
                {task.degraded && <span className="chip tone-warn">结论不完整</span>}
                <span className="meta">步骤 {task.completedStepCount}/{task.stepCount}</span>
                <span className="meta">调用 {task.callsUsed}/{task.maxTotalCalls}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
