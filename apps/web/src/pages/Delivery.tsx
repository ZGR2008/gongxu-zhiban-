import { useRef,useState } from "react";
import {useEditGuard,useUnsavedEdit} from '../components/EditGuard';
import { UiIcon, type IconName } from "../components/UiIcon";
import { CopyButton } from "../components/ContentView";
import { documentNames } from "../components/project-pulse-model";
import {documentEvidence,evidenceStamp,manualCheckFresh,type EvidenceSnapshot} from '../components/evidence-state';
import {totalsForVersion,type TestCasePage} from '../components/test-case-page';
import {
  blankDelivery,
  deliveryChecks,
  deliveryKey,
  readDelivery,
  type CheckId,
  type CheckRecord,
} from "./workbench-data";
import {
  dateLabel,
  downloadText,
  EmptyProjects,
  ProjectPicker,
  ReadError,
  useApiResource,
  type PageProps,
  type Requirement,
  type Run,
  type Api,
} from "./WorkbenchShared";

type TestCase = { id: string; requirementVersionId: string; result: string };
type Doc = {
  id: string;
  requirementVersionId: string;
  type: string;
  createdAt: string;
  sourceSnapshot?:EvidenceSnapshot|null;
};
export default function Delivery({
  projects,
  loading,
  unavailable,
  request,
  navigate,
}: PageProps) {
  const {protect}=useEditGuard();
  const [choice, setChoice] = useState("");
  const [revision, setRevision] = useState(0);
  const project =
    !loading && !unavailable
      ? (projects.find((item) => item.id === choice) ?? projects[0])
      : undefined;
  const detail = useApiResource<{ requirements: Requirement[] }>(
    request,
    project ? `/projects/${encodeURIComponent(project.id)}` : null,
    revision,
  );
  const confirmed = [...(detail.data?.requirements ?? [])]
    .sort((a, b) => b.version - a.version)
    .find((item) => item.status === "confirmed");
  if (!project)
    return (
      <EmptyProjects
        loading={loading}
        unavailable={unavailable}
        navigate={navigate}
      />
    );
  return (
    <section className="wb-page delivery-center">
      <div className="wb-page-heading">
        <div>
          <span className="eyebrow">REVIEW / EVIDENCE / HANDOFF</span>
          <h2>让交付，经得起逐项核对。</h2>
          <p>
            先查看已有成果，再记录人工检查结论。清单勾选不会改变项目、任务或测试状态。
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => navigate(`/projects/${project.id}/documents`)}
        >
          打开文档中心 <UiIcon name="arrow" size={16} />
        </button>
      </div>
      <div className="wb-scope-toolbar">
        <ProjectPicker
          projects={projects}
          id="delivery-project"
          value={project.id}
          onChange={value=>protect(()=>setChoice(value))}
        />
        <span className="delivery-version">
          {detail.loading
            ? "正在读取需求…"
            : confirmed
              ? `依据需求 V${confirmed.version}`
              : detail.error
                ? "需求暂不可用"
                : "尚无已确认需求"}
        </span>
        <button
          className="button secondary"
          type="button"
          disabled={detail.loading}
          onClick={() => protect(()=>setRevision((value) => value + 1))}
        >
          刷新成果记录
        </button>
      </div>
      {detail.error ? (
        <ReadError
          message={detail.error}
          retry={() => setRevision((value) => value + 1)}
        />
      ) : !detail.data ? (
        <div className="wb-empty" role="status">
          正在读取项目资料…
        </div>
      ) : (
        <DeliveryBoard
          key={deliveryKey(project.id, confirmed?.id)}
          project={project}
          requirement={confirmed}
          request={request}
          revision={revision}
          navigate={navigate}
        />
      )}
    </section>
  );
}

function DeliveryBoard({
  project,
  requirement,
  request,
  revision,
  navigate,
}: {
  project: { id: string; name: string };
  requirement?: Requirement;
  request: Api;
  revision: number;
  navigate: (path: string) => void;
}) {
  const key = deliveryKey(project.id, requirement?.id);
  const [saved, setSaved] = useState(() => {
    try {
      return { record: readDelivery(localStorage.getItem(key)), error: "",dirty:false };
    } catch {
      return {
        record: blankDelivery(),
        error: "本机存储不可用，核对记录暂时无法持久保存。",
        dirty:false,
      };
    }
  });
  const savedRef=useRef(saved);savedRef.current=saved;
  function persist(record:typeof saved.record){
    let error='';try{localStorage.setItem(key,JSON.stringify(record));}catch{error='本机保存失败，当前修改仅在本页内存中。请重试保存或导出清单保留内容。';}
    const next={record,error,dirty:Boolean(error)};savedRef.current=next;setSaved(next);return !error;
  }
  useUnsavedEdit(`delivery:${key}`,{label:'尚未保存的本机交付核对',dirty:saved.dirty,save:async()=>persist(savedRef.current.record)});
  const [notice, setNotice] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const runs = useApiResource<{ runs: Run[] }>(
    request,
    `${base}/agent/runs`,
    revision,
  );
  const cases = useApiResource<TestCasePage<TestCase>>(
    request,
    `${base}/test-cases?summaryOnly=true${requirement?`&requirementVersionId=${encodeURIComponent(requirement.id)}`:''}`,
    revision,
  );
  const docs = useApiResource<{ documents: Doc[];evidence?:EvidenceSnapshot|null }>(
    request,
    `${base}/documents`,
    revision,
  );
  const reviews = useApiResource<{ reviews: { id: string }[] }>(
    request,
    `${base}/code-reviews`,
    revision,
  );
  const testCounts=totalsForVersion(cases.data?.summary,requirement?.id);
  const versionDocs =
    docs.data?.documents.filter(
      (item) => item.requirementVersionId === requirement?.id,
    ) ?? [];
  const confirmedPlans =
    runs.data?.runs.filter(
      (item) =>
        item.requirementVersionId === requirement?.id &&
        item.status === "confirmed",
    ) ?? [];
  const currentEvidence=!docs.loading&&!docs.error&&docs.data?.evidence?.requirementVersionId===requirement?.id?docs.data?.evidence:null;
  const trackedChecks=new Set<CheckId>(['requirements','plan','tests','documents']);
  const isCurrent=(id:CheckId)=>!trackedChecks.has(id)||manualCheckFresh(saved.record.items[id].status,saved.record.items[id].evidenceStamp,evidenceStamp(currentEvidence,id));
  const staleChecks=deliveryChecks.filter(item=>saved.record.items[item.id].status==='checked'&&!isCurrent(item.id));
  const staleDocumentTypes=new Set(versionDocs.filter(doc=>documentEvidence(doc,currentEvidence).status!=='current').map(doc=>doc.type));
  const evidence: Record<CheckId, string> = {
    requirements: requirement
      ? `已有已确认需求 V${requirement.version}`
      : "尚无已确认需求，请先确认实训范围",
    plan: runs.error
      ? "规划记录暂不可用"
      : runs.loading
        ? "正在读取规划记录…"
        : `${confirmedPlans.length} 份当前需求的已确认计划（本次读取范围）`,
    review: reviews.error
      ? "审查记录暂不可用"
      : reviews.loading
        ? "正在读取审查记录…"
        : `${reviews.data?.reviews.length ?? 0} 条项目审查记录；建议需人工验证`,
    tests: cases.error
      ? "用例记录暂不可用"
      : cases.loading
        ? "正在读取测试记录…"
        : !requirement?'尚无已确认需求，不统计测试结果':!testCounts?'完整版本统计暂不可用，请刷新核对':`${testCounts.total} 条当前需求用例（完整版本统计），${testCounts.total-testCounts.notRun} 条人工登记结果，${testCounts.failed+testCounts.blocked} 条失败或阻塞`,
    documents: docs.error
      ? "文档暂不可用"
      : docs.loading
        ? "正在读取文档记录…"
        : `${new Set(versionDocs.map((item) => item.type)).size} 类当前需求文档已保存；${staleDocumentTypes.size} 类有来源变化或缺少快照，须复核内容`,
    demo: "平台没有自动检查部署、仓库访问或正式竞赛材料",
  };
  const completed = deliveryChecks.filter(
    (item) => saved.record.items[item.id].status === "checked"&&isCurrent(item.id),
  ).length;
  const blocked = deliveryChecks.filter(
    (item) => saved.record.items[item.id].status === "blocked",
  ).length;
  function update(id: CheckId, patch: Partial<CheckRecord>) {
    const next = {
      ...saved.record,
      updatedAt: new Date().toISOString(),
      items: {
        ...saved.record.items,
        [id]: { ...saved.record.items[id], ...patch,...(patch.status==='checked'&&trackedChecks.has(id)?{evidenceStamp:evidenceStamp(currentEvidence,id)}:{}) },
      },
    };
    persist(next);
    setNotice("");
  }
  const report = [
    `# ${project.name} · 人工交付核对`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    `依据：${requirement ? `已确认需求 V${requirement.version}` : "尚无已确认需求"}`,
    `人工确认 ${completed}/6 项，${blocked} 项待处理。此统计不是自动验收或项目完成结论。`,
    `另有 ${staleChecks.length} 项旧核对缺少当前依据，需重新核对；原备注保留。`,
    "核对记录保存在当前浏览器；下方成果摘要来自本次读取。",
    ...deliveryChecks.flatMap((item) => [
      `## ${item.title}`,
      `人工状态：${{ todo: "待核对", checked: "已人工核对", blocked: "待处理" }[saved.record.items[item.id].status]}`,
      `依据核对：${saved.record.items[item.id].status==='checked'&&!isCurrent(item.id)?'已变化或不可核对，旧结论不计入本次确认':'以本次读取范围为准，非自动验收'}`,
      `成果摘要：${evidence[item.id]}`,
      `备注：${saved.record.items[item.id].note || "尚未填写"}`,
    ]),
    "## 数据范围",
    "规划、文档和审查最多读取最近 100 条；测试用例最多 200 条。测试与文档按当前已确认需求过滤，测试结果由人工登记。没有运行用户代码，也没有检查线上部署。",
  ].join("\n\n");
  return (
    <div className="delivery-grid" aria-busy={docs.loading}>
      <div>
        <div className="delivery-local-note">
          <UiIcon name="bookmark" size={19} />
          <div>
            <strong>人工核对记录 · 保存在本机</strong>
            <p>
              按项目和需求版本分别保存。刷新可恢复；换设备或清理浏览器数据后不会自动同步。
            </p>
          </div>
          <span role="status">
            {saved.error
              ? "尚未保存"
              : saved.record.updatedAt
                ? `已保存 ${dateLabel(saved.record.updatedAt)}`
                : "尚未填写"}
          </span>
        </div>
        {saved.error && (
          <p className="wb-warning" role="alert">
            {saved.error}
            <button type="button" className="text-link" onClick={()=>persist(savedRef.current.record)}>重试保存核对记录</button>
          </p>
        )}
        {!docs.loading&&staleChecks.length>0&&<p className="wb-warning" role="status">{staleChecks.length} 项旧核对的依据已变化、不可读取或尚未记录。原备注仍然保留，请核对当前资料后重新确认。</p>}
        {!requirement && (
          <p className="wb-warning">
            当前没有已确认需求，清单用于准备工作；确认需求后会使用独立的新版本清单。
          </p>
        )}
        <div className="delivery-checks">
          {deliveryChecks.map((item, index) => (
            <article
              className={`delivery-check delivery-check--${saved.record.items[item.id].status}`}
              key={item.id}
            >
              <div className="delivery-check-heading">
                <span className="delivery-check-number">0{index + 1}</span>
                <div>
                  <h3>
                    <UiIcon name={item.icon as IconName} size={17} />
                    {item.title}
                  </h3>
                  <p>{item.hint}</p>
                </div>
                <label
                  className="sr-only"
                  htmlFor={`delivery-${item.id}-status`}
                >
                  {item.title}核对状态
                </label>
                <select
                  id={`delivery-${item.id}-status`}
                  disabled={trackedChecks.has(item.id)&&docs.loading}
                  value={saved.record.items[item.id].status}
                  onChange={(event) =>
                    update(item.id, {
                      status: event.target.value as CheckRecord["status"],
                    })
                  }
                >
                  <option value="todo">待核对</option>
                  <option value="checked" disabled={trackedChecks.has(item.id)&&!currentEvidence}>已人工核对</option>
                  <option value="blocked">待处理</option>
                </select>
              </div>
              <div className="delivery-evidence">
                <span>当前成果</span>
                <p>{evidence[item.id]}</p>
              </div>
              {!docs.loading&&saved.record.items[item.id].status==='checked'&&!isCurrent(item.id)&&<div className="delivery-recheck"><span>旧结论待复核 · 不计入当前确认</span><button className="button secondary" type="button" disabled={!currentEvidence} onClick={()=>update(item.id,{status:'checked'})}>已核对当前资料</button></div>}
              <label htmlFor={`delivery-${item.id}-note`}>
                {item.title}核对备注
              </label>
              <textarea
                id={`delivery-${item.id}-note`}
                rows={2}
                maxLength={2000}
                value={saved.record.items[item.id].note}
                placeholder="记录核对内容、未解决问题或证据位置…"
                onChange={(event) =>
                  update(item.id, { note: event.target.value })
                }
              />
            </article>
          ))}
        </div>
      </div>
      <aside className="delivery-summary">
        <span className="eyebrow">YOUR HANDOFF CHECKLIST</span>
        <h3>交付前，最后一次核对</h3>
        <div className="delivery-count">
          <strong>{docs.loading?'—':completed}</strong>
          <span>/ 6 项人工确认</span>
        </div>
        <div
          className="delivery-progress"
          role="progressbar"
          aria-label="人工交付核对进度"
          aria-valuemin={0}
          aria-valuemax={6}
          aria-valuenow={docs.loading?undefined:completed}
        >
          <span style={{ width: `${(completed / 6) * 100}%` }} />
        </div>
        <p>
          {blocked
            ? `${blocked} 项标记为待处理，建议先记录问题及下一步。`
            : completed === 6
              ? "清单已人工填写完成，请结合真实成果复核。"
              : "逐项检查，并把未完成事项留在清单中。"}
        </p>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            try {
              downloadText(`handoff-${project.id.slice(0, 8)}.md`, report);
              setNotice("已发起交付清单下载。");
              setDownloadError("");
            } catch {
              setDownloadError("下载未能开始，请使用复制清单保留内容。");
            }
          }}
        >
          导出交付清单 <UiIcon name="delivery" size={16} />
        </button>
        <CopyButton value={report} label="复制交付清单" />
        {notice && (
          <p className="delivery-download-note" role="status">
            {notice}
          </p>
        )}
        {downloadError && (
          <p className="wb-warning" role="alert">
            {downloadError}
          </p>
        )}
        <div className="delivery-summary-divider" />
        <h4>当前需求的文档</h4>
        {Object.entries(documentNames).map(([type, name]) => (
          <div className="delivery-doc-row" key={type}>
            <span>{name}</span>
            <small>
              {docs.error
                ? "暂不可用"
                : docs.loading
                  ? "读取中"
                  : !requirement
                    ? "待确认需求"
                    : versionDocs.some((item) => item.type === type)
                      ? "已保存"
                      : "待补充"}
            </small>
          </div>
        ))}
        <button
          type="button"
          className="text-link"
          onClick={() => navigate(`${base}/documents`)}
        >
          编辑与导出原文档 →
        </button>
        <p className="wb-fineprint">
          成果最多读取最近 100 条运行/文档/审查及 200
          条用例；记录存在不等于通过验收。
        </p>
      </aside>
    </div>
  );
}
