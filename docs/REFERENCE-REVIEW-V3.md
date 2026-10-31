# 公开参考来源与原创实现说明（v3）

核对日期：2026年11月1日。参赛名称采用用户确认的“传智杯 AI WEB 网页开发挑战赛”；本项目的验收依据仍是用户提供的七张截图。来源核对不补造评分表，不把高校校赛规则、其他赛道奖项或往届安排移用于本届。

## 获奖材料与参赛仓库分别记录

| 来源与日期 | 能确认的赛事、阶段、组别与作品 | 不能据此确认的内容 | 本项目借鉴方式 |
| --- | --- | --- | --- |
| [河南轻工职业学院人工智能学院通报](https://rgznxy.havcli.edu.cn/info/1714/1724.htm)，2026-06-12 | 2025—2026第八届；AI WEB网页开发挑战赛；C组；《数智康护AI健康管理系统》省赛一等奖、国赛三等奖 | 不是国赛一等奖；报道不能替代源码审查或本届评分要求 | 垂直场景、前后端与AI能力围绕真实问题组织，是通用产品思路。未复制项目实现或素材 |
| [广东工商职业技术大学计算机学院通报](https://jsjx.gdbtu.edu.cn/contents/514/55081.html)，2026-06-30 | 2025—2026第八届国赛；AI WEB赛道“几何智核”“传智Web战队”获二等奖 | 正文未明确组别；同文一等奖属于AI大模型创新应用赛道，不能移作AI WEB一等奖 | 借鉴完整交互流程的重要性，不根据通报想象具体实现；直接打开曾超时，官方站点索引正文可核对 |
| [湄洲湾职业技术学院展示材料](https://xxgcx.fjmzw.com/_t13/2026/0616/c722a114178/page.htm)，页面日期2026-06-16 | 表格列出2025—2026第八届AI WEB赛道国家级一等奖 | 表中年度栏写2025年；没有足够的项目、组别、具体实现材料，不能认作已完整核实的C组国一源码案例 | 仅记录线索，不推演其获奖原因，不借此作同组技术对标 |
| [Triple-Y作者README](https://github.com/sssweetis/chuanzhi-cup-ai-web_Triple-Y/blob/main/README.md) | 作者自述第九届参赛；项目为“不漏办·智能办事清单助手”；[仓库许可](https://github.com/sssweetis/chuanzhi-cup-ai-web_Triple-Y/blob/main/LICENSE)为MIT | 没有独立获奖证明、充分组别与比赛阶段信息，不能称为往届获奖作品 | 只了解按场景组织任务与信息的通用方法。未复制代码、文案、图像、组件或特色界面 |
| [Little_World_Explorer作者README](https://github.com/NingQi-GUN/Little_World_Explorer/blob/main/README.md) | 作者描述自然识别、故事和语音等AI交互 | 届次、年份、组别、获奖依据不完整；未找到可据以复制使用的顶层许可证 | 只观察交互与场景融合方向，不下载或复制该仓库资源 |

本轮没有取得“同届同赛道C组国家一等奖、完整实现可复核”的参考样本。不能将未证实的仓库或其他赛道的奖项用于背书，也不能把自评通过等同于获奖。

## 本届公开规则线索的使用边界

[黄河交通学院2026-10-09通知](https://dw.zjtu.edu.cn/content/tzgs/202610/2463.html)明确是第九届校内选拔通知，列有AI WEB赛道。它的队伍人数、校内报名日期以及5%/10%/15%奖项比例不作为本项目省赛或国赛规则。我们保留截图中的1—3名同校学生、至多2名指导教师等可见要求，缺少的本届完整规则继续标为信息不足。

[传智杯官网](https://www.boxuegu.com/match/)与[赛道选择页](https://www.boxuegu.com/matchTrack/)此前公开查询未取得可核对的同届同赛道完整评分权重和国赛细则。不得以总赛事时间线覆盖截图中的该赛道省赛安排。未报名、未付款、未提交材料、未联系组委会或参赛者。

## 第三方资源与开发工具

| 资源 | 实际用途与许可依据 | 分发边界 |
| --- | --- | --- |
| [SaturnWebGL](https://github.com/adelmassimo/SaturnWebGL)，MIT；Three.js既有依赖 | 已有星环装饰场景，本轮保持来源声明；见`apps/web/public/previews/vendor/NOTICE.txt`及`apps/web/public/THIRD-PARTY-LICENSES.txt` | 原版权声明继续随前端资源保留；不列为原创AI算法 |
| [PDF.js](https://github.com/mozilla/pdf.js)及现有应用依赖 | 文本PDF解析与既有工程能力；依赖版本以锁文件为准 | 不把依赖下载目录打入源码包；按各自许可与项目声明管理 |
| ReportLab、pypdf、pdfplumber、Pillow | 本机生成技术评审稿、检查页数/边界、渲染总览；依赖自身随包许可 | 属于材料制作工具，不增加应用运行时依赖；不打包Python环境或系统字体文件 |
| [imageio-ffmpeg 0.6.0官方PyPI发行](https://pypi.org/project/imageio-ffmpeg/0.6.0/) | 下载Windows wheel，取其中FFmpeg 7.1用于本地录制/转码；wheel SHA-256为`02fa47c83703c37df6bfe4896aab339013f62bf02c5ebf2dce6da56af04ffc0a` | Python包装项目为BSD-2-Clause；**所用FFmpeg二进制自身`-L`输出为GPL v3或更高**，二者不可混同。工具放在工作区外层`.review-tools`，不作为本项目源码/运行时资源分发 |
| Windows已安装中文语音 | 仅本机把原创讲稿转成演示草稿配音，无云端TTS或费用 | 声音明确为合成语音；未复制语音引擎或系统字体，正式成片仍需真人听审/重新录音 |
| [Deque axe-core 4.14.0](https://github.com/dequelabs/axe-core)，MPL-2.0 | 桌面合成浏览器可访问性扫描；官方npm公开安装接口核对版本、许可与完整性，锁文件固定版本 | 仅开发测试依赖，无源码或页面上传，不进入应用生产包；自动检查不等于完整无障碍符合性，详情见ACCESSIBILITY-V3.md |

没有从公开案例复制代码、文案、素材或特色界面。新录制画面来自本项目实际浏览器和合成账号；字幕、讲稿、图表、需求样例及评测数据由本项目编写。系统中已有开源依赖与视觉资源不因此变成自研成果。

## 原创实现与证据

向量查询实验只参考[BAAI bge-small-zh-v1.5官方模型卡](https://huggingface.co/BAAI/bge-small-zh-v1.5)的使用方法：短查询可以比较检索指令，文档无需添加；是否采用要结合具体任务测量。没有把模型卡上的公开基准成绩写成本项目成绩。原始资料、30个测量问题和对照工具由本项目编写；本地模型仍沿用已核验版本与现有许可，不因实验重新下载或替换模型。

- 稳定条目标识、明确版本和人工关联：`apps/api/src/trace/domain.ts`、`trace/routes.ts`及迁移011。
- 任务—用例明确配对、修订失效与审核历史：`trace/task-test.ts`、迁移017和本地隔离验证。
- 同版本证据变化使文档/交付待复核：迁移013、`documents/evidence.ts`与前端`evidence-state.ts`。
- Agent取消、心跳中断、重复请求和人工计划审核：`agent/lifecycle.ts`、迁移014—016及真实本地恢复脚本。
- 请求归属、并发修订、未保存保护、失败快照只读：现有页面组件及`reliability-browser.mjs`。
- 检索与Agent共享有界容量、真实状态及来源核对：`rag/embeddings.ts`等原有检索模块。

这些是工程与应用实现，不声称发明新模型架构、证明引用语义正确、完成多Agent自治或提高了学生成绩。它们与测试、迁移和Git阶段提交相互对应。
