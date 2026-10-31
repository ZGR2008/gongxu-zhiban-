export type Mission = {
  id: string;
  title: string;
  category: "业务系统" | "效率工具" | "AI 应用";
  level: "入门" | "进阶" | "综合";
  hours: string;
  tagline: string;
  problem: string;
  skills: string[];
  goals: string[];
  features: string[];
  acceptance: string[];
  stretch: string;
};

// Original practice briefs. These are learning inputs, never completed student work.
export const missions: Mission[] = [
  {
    id: "campus-books",
    title: "校园共享书架",
    category: "业务系统",
    level: "入门",
    hours: "6–10",
    tagline: "把借阅规则，写成可以验证的需求。",
    problem:
      "班级有一个共享书架，目前用纸张登记借还，容易出现库存不准、归还遗漏。为同学和管理员设计一个小型借阅 Web 应用。",
    skills: ["需求分析", "React", "SQL", "边界测试"],
    goals: [
      "区分学生与管理员的操作边界",
      "把借阅约束转换为验收条件",
      "建立可追溯的测试记录",
    ],
    features: [
      "书目搜索、分类与可借数量展示",
      "学生提交借阅，管理员登记归还",
      "每名学生最多同时借阅 3 本书",
      "保留每次借还的时间与操作记录",
    ],
    acceptance: [
      "库存为 0 时拒绝新增借阅",
      "已有 3 本未归还时不能再借",
      "同一次归还不能重复增加库存",
      "未登录时可查看书目，但不能借阅",
    ],
    stretch: "为并发借阅最后一本书设计数据一致性方案，并记录尚未完成的验证。",
  },
  {
    id: "room-reservation",
    title: "实训室预约",
    category: "业务系统",
    level: "进阶",
    hours: "10–16",
    tagline: "让时间冲突，成为看得见的工程问题。",
    problem:
      "社团和课程共用实训室，预约通过群聊进行，常常重复占用。建立按日期、房间与时间段管理的预约平台。",
    skills: ["状态设计", "React", "数据库", "并发边界"],
    goals: [
      "明确申请、批准、取消的状态流转",
      "定义相邻时段与重叠时段",
      "为冲突检测设计测试",
    ],
    features: [
      "按房间和日期查询可用时段",
      "申请中、已批准、已取消的预约状态",
      "管理员审核预约并填写原因",
      "保存预约人与变更时间",
    ],
    acceptance: [
      "同一房间已批准的重叠时段不能再次批准",
      "前一预约结束时间等于后一开始时间时允许相邻预约",
      "不能创建开始时间晚于结束时间的预约",
      "取消预约后释放对应时段，但保留历史记录",
    ],
    stretch:
      "研究两个管理员同时批准冲突预约的处理方式，区分设计方案与实测结果。",
  },
  {
    id: "repair-desk",
    title: "校园设备报修",
    category: "业务系统",
    level: "进阶",
    hours: "10–14",
    tagline: "把一句“坏了”，变成完整的问题闭环。",
    problem:
      "机房设备故障描述不完整，维修进度也难追踪。设计一个从学生报修到维修完成、学生确认的工单应用。",
    skills: ["流程建模", "表单交互", "权限", "测试设计"],
    goals: [
      "设计清晰的工单状态机",
      "验证不同角色的权限边界",
      "用证据说明问题是否解决",
    ],
    features: [
      "填写设备编号、位置与故障描述",
      "待受理、处理中、待确认、已关闭状态",
      "维修人员追加处理记录",
      "学生确认修复或退回继续处理",
    ],
    acceptance: [
      "空白故障描述不能提交",
      "学生不能修改其他人的工单",
      "未填写处理说明不能转为待确认",
      "退回工单保留原处理记录和退回原因",
    ],
    stretch: "加入重复问题提示，但不能未经用户确认自动合并工单。",
  },
  {
    id: "study-cards",
    title: "知识复习卡",
    category: "效率工具",
    level: "入门",
    hours: "5–8",
    tagline: "从一次作答，练习状态与交互设计。",
    problem:
      "学习软件工程时，知识点散落在笔记中。建立可按主题整理问答卡片、记录实际复习结果的小工具。",
    skills: ["TypeScript", "组件设计", "持久化", "交互测试"],
    goals: [
      "区分题目内容与复习记录",
      "设计键盘也能使用的操作",
      "用真实练习数据展示进度",
    ],
    features: [
      "创建、编辑与按标签搜索卡片",
      "先看问题，再主动展开答案",
      "由用户记录掌握、模糊或不会",
      "按实际记录筛选待复习内容",
    ],
    acceptance: [
      "刷新后已保存卡片仍存在",
      "未展开答案前不记录掌握结果",
      "没有复习记录时显示未开始",
      "空题目不能保存，删除前允许用户取消",
    ],
    stretch: "用明确可解释的规则安排复习顺序，避免把规则建议包装成能力测评。",
  },
  {
    id: "club-events",
    title: "社团活动报名",
    category: "业务系统",
    level: "进阶",
    hours: "8–12",
    tagline: "把人数限制与截止时间写清楚。",
    problem:
      "社团活动用表格收集报名，超额、重复报名与取消记录难以处理。设计带人数限制和截止时间的活动报名应用。",
    skills: ["API 设计", "表单校验", "SQL", "异常测试"],
    goals: [
      "明确重复提交与名额规则",
      "设计可读的错误反馈",
      "验证截止与取消的边界",
    ],
    features: [
      "活动列表、详情与剩余名额",
      "学生报名与取消自己的报名",
      "报名截止后禁止新增报名",
      "组织者查看当前报名与取消记录",
    ],
    acceptance: [
      "同一账号不能重复占用名额",
      "名额已满时返回明确提示",
      "截止时刻及之后禁止新增报名",
      "重复取消不会再次释放名额",
    ],
    stretch: "设计候补队列，说明候补确认与过期规则，并为其补充用例。",
  },
  {
    id: "course-rag",
    title: "课程资料问答助手",
    category: "AI 应用",
    level: "综合",
    hours: "12–18",
    tagline: "让每个回答，都能回到原始资料。",
    problem:
      "学生从课程资料中查找答案耗时，直接问模型又难以核对依据。为自己有使用权的课程资料设计可追溯的问答 Web 应用。",
    skills: ["RAG", "引用核对", "异步状态", "质量评测"],
    goals: [
      "串联上传、分块、索引与检索状态",
      "让答案引用对应到实际片段",
      "设计无资料、无命中和服务失败时的体验",
    ],
    features: [
      "上传文本资料并显示处理状态",
      "语义检索返回原始片段与来源",
      "基于检索片段生成回答",
      "保留问题与引用，支持人工核对",
    ],
    acceptance: [
      "未建立索引的资料不冒充可检索",
      "无相关片段时明确告知依据不足",
      "引用标识必须对应实际返回片段",
      "模型或向量服务失败时不能显示伪造答案",
    ],
    stretch:
      "自编一组已知答案的问题，记录检索命中情况与人工依据判断，形成小型评测集。",
  },
];

export function missionBrief(mission: Mission) {
  return [
    `# ${mission.title} · 原创实训任务书`,
    "此内容是练习需求，不表示功能已经实现。",
    "## 场景与问题",
    mission.problem,
    "## 学习目标",
    ...mission.goals.map((text) => `- ${text}`),
    "## 核心范围",
    ...mission.features.map((text) => `- ${text}`),
    "## 验收条件",
    ...mission.acceptance.map((text) => `- ${text}`),
    "## 选做挑战",
    mission.stretch,
    "## 交付要求",
    "- 保存并确认需求，审阅 Agent 计划与知识来源。",
    "- 提交代码审查，区分确定性诊断与 AI 建议。",
    "- 设计并人工执行测试，记录真实结果。",
    "- 整理 README、设计与测试记录，明确未完成事项。",
  ].join("\n\n");
}

export const runStates: Record<string, string> = {
  running: "运行中",
  awaiting_review: "待人工审核",
  confirmed: "计划已确认",
  failed: "失败",
  succeeded: "步骤成功",
  skipped: "已跳过",
};
export const stageNames: Record<string, string> = {
  knowledge_search: "知识检索",
  plan_1: "首次规划",
  plan_2: "调整规划",
  validate_1: "首次校验",
  validate_2: "再次校验",
  validate_plan: "计划校验",
};
export function elapsedMs(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
export function durationLabel(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return "未记录";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} 秒`;
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
export const deliveryChecks = [
  {
    id: "requirements",
    title: "需求与范围",
    icon: "document",
    hint: "目标用户、核心功能、边界条件与验收口径已核对。",
  },
  {
    id: "plan",
    title: "任务与产物",
    icon: "agent",
    hint: "已审阅任务计划与依赖，并核对真实产物。",
  },
  {
    id: "review",
    title: "代码与审查",
    icon: "code",
    hint: "语法诊断已处理，AI 建议经过人工判断与必要验证。",
  },
  {
    id: "tests",
    title: "测试与证据",
    icon: "test",
    hint: "在自己的测试环境中执行用例，并保留实际结果。",
  },
  {
    id: "documents",
    title: "项目文档",
    icon: "knowledge",
    hint: "文档内容与实际实现一致，未完成事项明确列出。",
  },
  {
    id: "demo",
    title: "演示与交付",
    icon: "delivery",
    hint: "运行说明、演示路线、仓库权限与交付材料已人工核对。",
  },
] as const;
export type CheckId = (typeof deliveryChecks)[number]["id"];
export type CheckRecord = {
  status: "todo" | "checked" | "blocked";
  note: string;
  evidenceStamp?:string|null;
};
export type DeliveryRecord = {
  version: 1;
  updatedAt: string | null;
  items: Record<CheckId, CheckRecord>;
};
export function blankDelivery(): DeliveryRecord {
  return {
    version: 1,
    updatedAt: null,
    items: Object.fromEntries(
      deliveryChecks.map((check) => [check.id, { status: "todo", note: "" }]),
    ) as DeliveryRecord["items"],
  };
}
export function readDelivery(raw: string | null): DeliveryRecord {
  const fallback = blankDelivery();
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !value.items || typeof value.items !== "object")
      return fallback;
    for (const check of deliveryChecks) {
      const item = value.items[check.id];
      if (
        item &&
        ["todo", "checked", "blocked"].includes(item.status) &&
        typeof item.note === "string" &&
        item.note.length <= 2000
      )
        fallback.items[check.id] = { status: item.status, note: item.note,...(typeof item.evidenceStamp==='string'&&item.evidenceStamp.length<=200?{evidenceStamp:item.evidenceStamp}:item.evidenceStamp===null?{evidenceStamp:null}:{}) };
    }
    fallback.updatedAt =
      typeof value.updatedAt === "string" &&
      Number.isFinite(Date.parse(value.updatedAt))
        ? value.updatedAt
        : null;
    return fallback;
  } catch {
    return fallback;
  }
}
export function deliveryKey(
  projectId: string,
  requirementId: string | undefined,
) {
  return `gongxu-delivery-v1:${projectId}:${requirementId || "unconfirmed"}`;
}
