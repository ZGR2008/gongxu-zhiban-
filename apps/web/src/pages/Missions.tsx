import { useState, type FormEvent } from "react";
import { UiIcon, type IconName } from "../components/UiIcon";
import { CopyButton } from "../components/ContentView";
import { missions, missionBrief, type Mission } from "./workbench-data";
import type { Api } from "./WorkbenchShared";

const categoryIcons: Record<string, IconName> = {
  业务系统: "projects",
  效率工具: "layers",
  "AI 应用": "spark",
};
function readFavorites() {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem("gongxu-mission-favorites") || "[]",
    );
    return Array.isArray(value)
      ? value.filter(
          (id): id is string =>
            typeof id === "string" &&
            missions.some((mission) => mission.id === id),
        )
      : [];
  } catch {
    return [];
  }
}
export default function Missions({
  path,
  request,
  navigate,
}: {
  path: string;
  request: Api;
  navigate: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [favorites, setFavorites] = useState(readFavorites);
  const [storageError, setStorageError] = useState("");
  const slug = path.split("/")[2];
  const mission = missions.find((item) => item.id === slug);
  function toggle(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((value) => value !== id)
      : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem("gongxu-mission-favorites", JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError("浏览器暂时无法保存收藏，当前选择仅本次有效。");
    }
  }
  if (slug)
    return mission ? (
      <MissionDetail
        key={mission.id}
        mission={mission}
        request={request}
        navigate={navigate}
        favorite={favorites.includes(mission.id)}
        onFavorite={() => toggle(mission.id)}
        storageError={storageError}
      />
    ) : (
      <div className="wb-empty">
        <h2>没有找到这份任务书</h2>
        <p>可以返回任务库选择一个现有主题。</p>
        <button
          type="button"
          className="button secondary"
          onClick={() => navigate("/missions")}
        >
          返回任务库
        </button>
      </div>
    );
  const filtered = missions.filter(
    (item) =>
      (level === "all" || item.level === level) &&
      (category === "all" || item.category === category) &&
      (!savedOnly || favorites.includes(item.id)) &&
      `${item.title}${item.tagline}${item.skills.join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="wb-page mission-library">
      <div className="mission-hero">
        <div>
          <span className="eyebrow">PRACTICE / EXPLORE / BUILD</span>
          <h2>
            找到你的下一次
            <br />
            <span>工程实践。</span>
          </h2>
          <p>
            从具体场景出发，把需求、规划、审查、测试与交付连成一次完整练习。
          </p>
          <div className="mission-hero-meta">
            <span>{missions.length} 个原创实训主题</span>
            <span>3 个练习层次</span>
            <span>接入真实项目流程</span>
          </div>
        </div>
        <div className="mission-blueprint" aria-hidden="true">
          <div className="blueprint-line" />
          <span className="blueprint-node blueprint-node--one">
            <UiIcon name="document" />
            需求
          </span>
          <span className="blueprint-node blueprint-node--two">
            <UiIcon name="agent" />
            规划
          </span>
          <span className="blueprint-node blueprint-node--three">
            <UiIcon name="test" />
            验证
          </span>
          <span className="blueprint-node blueprint-node--four">
            <UiIcon name="delivery" />
            交付
          </span>
          <div className="blueprint-core">
            <UiIcon name="spark" size={34} />
            <small>YOUR NEXT BUILD</small>
          </div>
        </div>
      </div>
      <div className="mission-toolbar">
        <div className="wb-search">
          <UiIcon name="search" size={17} />
          <label className="sr-only" htmlFor="mission-search">
            搜索实训任务
          </label>
          <input
            id="mission-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索主题或技能，如 RAG、测试…"
          />
        </div>
        <label className="sr-only" htmlFor="mission-level">
          练习难度
        </label>
        <select
          id="mission-level"
          value={level}
          onChange={(event) => setLevel(event.target.value)}
        >
          <option value="all">全部难度</option>
          {["入门", "进阶", "综合"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="mission-category">
          任务方向
        </label>
        <select
          id="mission-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">全部方向</option>
          {["业务系统", "效率工具", "AI 应用"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <button
          type="button"
          className={`button secondary ${savedOnly ? "selected" : ""}`}
          aria-pressed={savedOnly}
          onClick={() => setSavedOnly((value) => !value)}
        >
          <UiIcon name="bookmark" size={15} />
          我的收藏
        </button>
      </div>
      <div className="wb-result-note">
        <span>找到 {filtered.length} 个任务</span>
        <span>预计时长为练习建议 · 收藏仅保存在当前浏览器</span>
      </div>
      {storageError && (
        <p className="wb-warning" role="status">
          {storageError}
        </p>
      )}
      {filtered.length ? (
        <div className="mission-grid">
          {filtered.map((item) => (
            <article
              className={`mission-card mission-card--${item.level === "综合" ? "cyan" : item.level === "入门" ? "lilac" : "purple"}`}
              key={item.id}
            >
              <div className="mission-card-top">
                <span className="mission-symbol">
                  <UiIcon name={categoryIcons[item.category]} size={26} />
                </span>
                <span className="small-tag">{item.level}</span>
                <button
                  type="button"
                  className="mission-bookmark"
                  aria-label={`${favorites.includes(item.id) ? "取消收藏" : "收藏"}${item.title}`}
                  aria-pressed={favorites.includes(item.id)}
                  onClick={() => toggle(item.id)}
                >
                  <UiIcon name="bookmark" size={17} />
                </button>
              </div>
              <span className="mission-category">
                {item.category} / ORIGINAL BRIEF
              </span>
              <h3>{item.title}</h3>
              <p>{item.tagline}</p>
              <div className="mission-skills">
                {item.skills.map((skill) => (
                  <span key={skill}>{skill}</span>
                ))}
              </div>
              <div className="mission-card-bottom">
                <span>
                  <UiIcon name="clock" size={13} />
                  {item.hours} 小时 · 建议
                </span>
                <a
                  href={`/missions/${item.id}`}
                  onClick={(event) => {
                    if (
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.shiftKey &&
                      event.button === 0
                    ) {
                      event.preventDefault();
                      navigate(`/missions/${item.id}`);
                    }
                  }}
                >
                  查看任务书 <UiIcon name="arrow" size={16} />
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="wb-empty">
          <UiIcon name="search" size={30} />
          <h3>没有匹配的任务</h3>
          <p>换个关键词，或者清除难度、方向与收藏筛选。</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setQuery("");
              setLevel("all");
              setCategory("all");
              setSavedOnly(false);
            }}
          >
            清除筛选
          </button>
        </div>
      )}
    </section>
  );
}

function MissionDetail({
  mission,
  request,
  navigate,
  favorite,
  onFavorite,
  storageError,
}: {
  mission: Mission;
  request: Api;
  navigate: (path: string) => void;
  favorite: boolean;
  onFavorite: () => void;
  storageError: string;
}) {
  const [name, setName] = useState(mission.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ project: { id: string } }>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: missionBrief(mission),
        }),
      });
      navigate(`/projects/${result.project.id}/requirements`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="wb-page mission-detail">
      <button
        type="button"
        className="text-link wb-back"
        onClick={() => navigate("/missions")}
      >
        ← 返回实训任务库
      </button>
      <div className="mission-detail-title">
        <div>
          <span className="eyebrow">
            ORIGINAL PRACTICE BRIEF / {mission.level}
          </span>
          <h2>{mission.title}</h2>
          <p>{mission.tagline}</p>
        </div>
        <button
          type="button"
          className="button secondary"
          aria-pressed={favorite}
          onClick={onFavorite}
        >
          <UiIcon name="bookmark" size={16} />
          {favorite ? "已收藏" : "收藏任务"}
        </button>
      </div>
      {storageError && (
        <p className="wb-warning" role="status">
          {storageError}
        </p>
      )}
      <div className="mission-detail-grid">
        <div className="mission-brief">
          <section>
            <span className="wb-section-number">01</span>
            <h3>从一个真实问题出发</h3>
            <p>{mission.problem}</p>
            <div className="mission-skills">
              {mission.skills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
          </section>
          <section>
            <span className="wb-section-number">02</span>
            <h3>这次重点练什么</h3>
            <ol>
              {mission.goals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ol>
          </section>
          <section>
            <span className="wb-section-number">03</span>
            <h3>先完成这些核心能力</h3>
            <ul>
              {mission.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>
          <section>
            <span className="wb-section-number">04</span>
            <h3>用明确条件验收</h3>
            <ul className="mission-acceptance">
              {mission.acceptance.map((item, index) => (
                <li key={item}>
                  <span>AC-{String(index + 1).padStart(2, "0")}</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section className="mission-stretch">
            <UiIcon name="spark" size={19} />
            <div>
              <h3>完成后，再挑战一步</h3>
              <p>{mission.stretch}</p>
            </div>
          </section>
        </div>
        <aside className="mission-start">
          <span className="eyebrow">START YOUR PRACTICE</span>
          <h3>把任务书带进工作台</h3>
          <p>
            创建后会写入项目简介，并进入需求编辑区。你可以修改任务范围，再保存和确认需求。
          </p>
          <form onSubmit={create}>
            <label htmlFor="mission-project-name">实训项目名称</label>
            <input
              id="mission-project-name"
              value={name}
              maxLength={120}
              required
              onChange={(event) => setName(event.target.value)}
            />
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="button primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "正在创建项目…" : "以此任务创建项目"}
              <UiIcon name="arrow" size={16} />
            </button>
          </form>
          <dl>
            <div>
              <dt>练习层次</dt>
              <dd>{mission.level}</dd>
            </div>
            <div>
              <dt>建议时长</dt>
              <dd>{mission.hours} 小时</dd>
            </div>
            <div>
              <dt>验收条件</dt>
              <dd>{mission.acceptance.length} 条</dd>
            </div>
          </dl>
          <CopyButton value={missionBrief(mission)} label="复制完整任务书" />
          <p className="wb-fineprint">
            原创练习内容。创建项目不会自动实现功能，也不会自动调用模型。
          </p>
        </aside>
      </div>
    </section>
  );
}
