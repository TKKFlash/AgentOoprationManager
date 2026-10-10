import { useEffect, useState } from "react";
import { getHealth, type HealthResponse } from "./api.js";
import { useRoute, type Route } from "./route.js";
import { TaskSpace } from "./tasks/TaskSpace.js";

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}
function Dot({ good }: { good: boolean }) { return <span className={`dot ${good ? "good" : "bad"}`} aria-hidden="true" />; }

function Breadcrumb({ route }: { route: Route }) {
  if (route.page === "new-task") {
    return <div>工作区 <i>/</i> <a href="#tasks">任务空间</a> <i>/</i> <strong>新建任务</strong></div>;
  }
  if (route.page === "task") {
    return <div>工作区 <i>/</i> <a href="#tasks">任务空间</a> <i>/</i> <strong>讨论室</strong></div>;
  }
  return <div>工作区 <i>/</i> <strong>任务空间</strong></div>;
}

export default function App() {
  const route = useRoute();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const refresh = async () => {
      try {
        const value = await getHealth(controller.signal);
        if (!active) return;
        setHealth(value); setError(null); setCheckedAt(new Date());
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setHealth(null); setError(cause instanceof Error ? cause.message : "无法连接本机服务"); setCheckedAt(new Date());
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; controller.abort(); window.clearInterval(interval); };
  }, []);

  const ready = health?.status === "ready" && health.storageStatus === "ready";
  const stamp = checkedAt?.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const overview = route.page === "overview";

  const sidebar = <aside className="sidebar">
    <a className="brand" href="#overview" aria-label="Agent Desk 首页"><BrandMark /><span><strong>agent desk</strong><small>LOCAL WORKSPACE</small></span></a>
    <div className="nav-label">工作区</div>
    <nav aria-label="主导航">
      <a className={`nav${overview ? " active" : ""}`} href="#overview" aria-current={overview ? "page" : undefined}><b>▦</b>总览<span>↗</span></a>
      <a className={`nav${overview ? "" : " active"}`} href="#tasks" aria-current={overview ? undefined : "page"}><b>◎</b>任务空间<span>↗</span></a>
    </nav>
    <div className="sidebar-bottom"><div className="local-box"><span className="home-icon">⌂</span><span><strong>仅在本机运行</strong><small>数据保存在此设备</small></span><Dot good={ready} /></div><p>AGENT OPERATIONS MANAGER · 0.1</p></div>
  </aside>;

  if (!overview) {
    return <div className="shell">
      {sidebar}
      <main className="task-main">
        <header className="topbar"><Breadcrumb route={route} /><span className="instance"><i />本地实例 <b>A</b></span></header>
        <div className="content task-content">
          <TaskSpace route={route} />
        </div>
      </main>
    </div>;
  }

  return <div className="shell">
    {sidebar}
    <main id="overview">
      <header className="topbar"><div>工作区 <i>/</i> <strong>总览</strong></div><span className="instance"><i />本地实例 <b>A</b></span></header>
      <div className="content">
        <section className="heading"><div><div className="eyebrow"><i />PHASE 02 <span>/</span> FOUNDATION</div><h1>你好，<em>工作台已就绪。</em></h1><p>本机协作底座正在运行。安全、存储与服务状态一目了然。</p></div><div className={`system ${ready ? "online" : "offline"}`}><Dot good={ready} />{ready ? "所有系统正常" : error ? "等待本机服务" : "正在检查"}</div></section>
        <section className="hero"><div className="hero-copy"><div className="kicker">✳ &nbsp;YOUR PRIVATE AI WORKSPACE</div><h2>把复杂任务，<br /><span>交给协作来完成。</span></h2><p>先搭好可靠的本机基础。智能体接入、任务编排与实时协作将在后续阶段逐步开放。</p><div className="hero-note"><i>✓</i>本机优先 <b /> 默认不向外网开放</div></div><div className="orbit" aria-hidden="true"><div className="ring r1" /><div className="ring r2" /><div className="ring r3" /><div className="core"><BrandMark /><small>LOCAL CORE</small></div><span className="node n1">01 · SERVER</span><span className="node n2">02 · STORAGE</span><span className="node n3">03 · READY</span><i className="cross c1">+</i><i className="cross c2">+</i></div><span className="hero-id">AOM — 001</span></section>
        <div className="section-title"><h2><span>01</span>运行状态</h2><small>{stamp ? `最近检查 ${stamp}` : "正在检查…"}</small></div>
        <section className="cards" aria-label="本机服务状态">
          <article className="card"><div className="card-top"><span className="icon">↗</span><small>APPLICATION</small><Dot good={ready} /></div><h3>本机服务</h3><p>{ready ? "API 服务可访问" : error ?? "正在连接服务…"}</p><div className="card-bottom"><code>127.0.0.1:4317</code><b>{ready ? "在线" : "离线"}</b></div></article>
          <article className="card"><div className="card-top"><span className="icon storage">▤</span><small>PERSISTENCE</small><Dot good={health?.storageStatus === "ready"} /></div><h3>本地存储</h3><p>{health?.storageStatus === "ready" ? "SQLite 读写检查通过" : "等待存储检查"}</p><div className="card-bottom"><code>SQLite · schema v{health?.schemaVersion ?? "—"}</code><b>{health?.storageStatus === "ready" ? "就绪" : "检查中"}</b></div></article>
          <article className="card"><div className="card-top"><span className="icon">✳</span><small>PROJECT PHASE</small><label>02 / 07</label></div><h3>本机应用底座</h3><p>前端、服务与持久层的基础运行环境。</p><div className="progress"><i /></div><div className="card-bottom"><code>当前阶段</code><b>基础就绪</b></div></article>
        </section>
        {error && <div className="notice" role="status">{error}。请确认本机服务已启动；页面会自动重试。</div>}
        <footer><span>DESIGNED FOR FOCUSED COLLABORATION</span><span><i /> LOCAL FIRST&nbsp; · &nbsp;PRIVATE BY DEFAULT</span></footer>
      </div>
    </main>
  </div>;
}
