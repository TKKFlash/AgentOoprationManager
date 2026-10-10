import { useEffect, useState, type FormEvent } from "react";
import type { CollaborationMode } from "@aom/shared";
import { api, type ProfilesResponse } from "../api.js";
import { errorMessage } from "./common.js";

const MAX_PARTICIPANTS_HINT = "最多可选择 6 位参与者";

function roleLabel(mode: CollaborationMode, index: number): string {
  if (index === 0) return mode === "coordinator" ? "协调者" : "主持收敛";
  return `第 ${index + 1} 位`;
}

export function NewTaskPage() {
  const [profiles, setProfiles] = useState<ProfilesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [mode, setMode] = useState<CollaborationMode>("coordinator");
  const [selected, setSelected] = useState<string[]>([]);
  const [maxTotalCalls, setMaxTotalCalls] = useState(12);
  const [maxRounds, setMaxRounds] = useState(3);
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.profiles()
      .then((response) => {
        setProfiles(response);
        setMaxTotalCalls(response.budget.defaults.maxTotalCalls);
        setMaxRounds(response.budget.defaults.maxRounds);
        setTimeoutSeconds(Math.round(response.budget.defaults.perCallTimeoutMs / 1_000));
      })
      .catch((cause: unknown) => setLoadError(errorMessage(cause)));
  }, []);

  function toggle(id: string): void {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= (profiles?.participantLimits.max ?? 6)) return current;
      return [...current, id];
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api.createTask({
        goal,
        acceptanceCriteria: criteriaText.split("\n").map((line) => line.trim()).filter((line) => line.length > 0),
        mode,
        participantIds: selected,
        budget: { maxTotalCalls, maxRounds, perCallTimeoutMs: timeoutSeconds * 1_000 },
        workingDirectory: workingDirectory.trim() || undefined,
      });
      window.location.hash = `#tasks/${encodeURIComponent(created.id)}`;
    } catch (cause) {
      setSubmitError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <section className="task-panel">
        <a className="back" href="#tasks">← 任务空间</a>
        <div className="notice" role="status">{loadError}</div>
      </section>
    );
  }
  if (!profiles) return <section className="task-panel"><p className="muted">正在读取参与者…</p></section>;

  const limits = profiles.budget.limits;
  const usesCodex = selected.some((id) => profiles.profiles.find((profile) => profile.id === id)?.adapterId === "codex-cli");
  const canSubmit = !submitting && goal.trim().length > 0 && selected.length >= profiles.participantLimits.min;

  return (
    <section className="task-panel">
      <a className="back" href="#tasks">← 任务空间</a>
      <div className="task-panel-head">
        <div>
          <h1>新建任务</h1>
          <p>参与者只会收到本次任务的简报与裁剪后的摘录，不会获得完整对话历史。</p>
        </div>
      </div>

      <form className="task-form" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>任务目标</span>
          <textarea
            value={goal}
            maxLength={profiles.textLimits.goal}
            rows={3}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="例如：比较两个方案的风险，并给出建议"
          />
          <small className="muted">{goal.trim().length}/{profiles.textLimits.goal}</small>
        </label>

        <label className="field">
          <span>验收标准（每行一条，可留空）</span>
          <textarea
            value={criteriaText}
            rows={3}
            onChange={(event) => setCriteriaText(event.target.value)}
            placeholder={"例如：\n给出明确结论\n列出依据"}
          />
        </label>

        <fieldset className="field">
          <legend>协作方式</legend>
          <div className="mode-options">
            {profiles.modes.map((option) => (
              <label key={option.id} className={`mode-option ${mode === option.id ? "picked" : ""}`}>
                <input
                  type="radio"
                  name="mode"
                  value={option.id}
                  checked={mode === option.id}
                  onChange={() => setMode(option.id)}
                />
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>参与者（按选择顺序排列；{MAX_PARTICIPANTS_HINT}）</legend>
          <div className="participants">
            {profiles.profiles.map((profile) => {
              const index = selected.indexOf(profile.id);
              return (
                <label key={profile.id} className={`participant ${index >= 0 ? "picked" : ""}`}>
                  <input type="checkbox" checked={index >= 0} onChange={() => toggle(profile.id)} />
                  <span className="participant-body">
                    <strong>{profile.name}</strong>
                    <small>{profile.role}</small>
                    <em>{profile.description}</em>
                  </span>
                  {index >= 0 && <span className="badge">{roleLabel(mode, index)}</span>}
                </label>
              );
            })}
          </div>
          {selected.length < profiles.participantLimits.min && (
            <small className="muted">请至少选择 {profiles.participantLimits.min} 位参与者。</small>
          )}
        </fieldset>

        {usesCodex && (
          <div className="notice info" role="note">
            所选 Codex（只读）会在每次调用时启动本机 codex 进程，并以只读沙箱运行。
            工作目录留空时，使用服务专用的空目录，不会访问项目目录。
          </div>
        )}

        <div className="field-row">
          <label className="field">
            <span>调用次数上限</span>
            <input
              type="number"
              min={limits.maxTotalCalls.min}
              max={limits.maxTotalCalls.max}
              value={maxTotalCalls}
              onChange={(event) => setMaxTotalCalls(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>讨论轮数（仅多轮讨论）</span>
            <input
              type="number"
              min={limits.maxRounds.min}
              max={limits.maxRounds.max}
              value={maxRounds}
              disabled={mode !== "discussion"}
              onChange={(event) => setMaxRounds(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>单次调用超时（秒）</span>
            <input
              type="number"
              min={limits.perCallTimeoutMs.min / 1_000}
              max={limits.perCallTimeoutMs.max / 1_000}
              value={timeoutSeconds}
              onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
            />
          </label>
        </div>

        {usesCodex && (
          <label className="field">
            <span>工作目录（可选，只读）</span>
            <input
              type="text"
              value={workingDirectory}
              onChange={(event) => setWorkingDirectory(event.target.value)}
              placeholder="绝对路径，例如 D:\\资料\\方案"
            />
          </label>
        )}

        {submitError && <div className="notice" role="alert">{submitError}</div>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={!canSubmit}>
            {submitting ? "提交中…" : "创建并开始"}
          </button>
        </div>
      </form>
    </section>
  );
}
