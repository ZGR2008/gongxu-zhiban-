import { useEffect, useState } from "react";
import { UiIcon } from "../components/UiIcon";
export type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
export type Project = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
};
export type PageProps = {
  request: Api;
  projects: Project[];
  loading: boolean;
  unavailable: boolean;
  navigate: (path: string) => void;
};
export type Requirement = {
  id: string;
  version: number;
  status: string;
  content: unknown;
};
export type ToolCall = {
  id: string;
  toolName: string;
  status: string;
  inputSummary: string;
  outputSummary: string;
  startedAt: string;
  finishedAt: string | null;
};
export type RunStep = {
  id: string;
  stage: string;
  status: string;
  outputSummary: string;
  startedAt: string;
  finishedAt: string | null;
  tools: ToolCall[];
};
export type Run = {
  id: string;
  requirementVersionId: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  modelName: string;
  errorCode: string | null;
  plan: unknown;
};
export type RunDetail = { run: Run; steps: RunStep[] };

export function useApiResource<T>(
  request: Api,
  path: string | null,
  revision = 0,
) {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path, data: null, error: "", loading: !!path });
  useEffect(() => {
    if (!path) {
      setState({ path, data: null, error: "", loading: false });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({
      path,
      data: previous.path === path ? previous.data : null,
      error: "",
      loading: true,
    }));
    request<T>(path, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ path, data, error: "", loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            path,
            data: null,
            error:
              error instanceof Error ? error.message : "读取失败，请重试。",
            loading: false,
          });
      });
    return () => controller.abort();
  }, [request, path, revision]);
  // Do not expose the previous project's data during the render before cleanup.
  return state.path === path
    ? state
    : { path, data: null, error: "", loading: !!path };
}
export function ProjectPicker({
  projects,
  value,
  onChange,
  id,
  disabled = false,
}: {
  projects: Project[];
  value: string;
  onChange: (value: string) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <div className="wb-project-picker">
      <label htmlFor={id}>当前项目</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || !projects.length}
      >
        {projects.length ? (
          projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))
        ) : (
          <option value="">暂无项目</option>
        )}
      </select>
    </div>
  );
}
export function EmptyProjects({
  loading,
  unavailable,
  navigate,
}: Pick<PageProps, "loading" | "unavailable" | "navigate">) {
  return (
    <div className="wb-empty" role={loading ? "status" : undefined}>
      <UiIcon name="projects" size={32} />
      <h3>
        {loading
          ? "正在读取项目…"
          : unavailable
            ? "项目暂时无法读取"
            : "从一个真实项目开始"}
      </h3>
      <p>
        {unavailable
          ? "请使用页面上方的重试按钮恢复读取。"
          : "创建项目后，在这里查看运行过程与准备交付材料。"}
      </p>
      {!loading && !unavailable && (
        <button
          type="button"
          className="button primary"
          onClick={() => navigate("/missions")}
        >
          从实训任务库开始 <UiIcon name="arrow" size={16} />
        </button>
      )}
    </div>
  );
}
export function ReadError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="alert error" role="alert">
      <p>{message}</p>
      <button type="button" onClick={retry}>
        重新读取
      </button>
    </div>
  );
}
export function dateLabel(value: string | null | undefined) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime())
    ? "未记录"
    : date.toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
export function downloadText(
  name: string,
  content: string,
  type = "text/markdown;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the URL alive long enough for WebKit to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
