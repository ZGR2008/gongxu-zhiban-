"""Build the v5 technical review from evidence, without config or network access.

Use the existing PDF verifier and Poppler to render and inspect every page.
This generator neither creates videos nor overwrites prior editions.
"""
from pathlib import Path
from datetime import datetime
from xml.sax.saxutils import escape
import json, hashlib, argparse
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, PageBreak, Image
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from pypdf import PdfReader
from PIL import Image as RasterImage

ROOT=Path(__file__).resolve().parents[1]
evidence=json.loads((ROOT/'docs/verification/review-v5.json').read_text(encoding='utf-8'))
assert evidence['realModels']['newCalls']==0 and evidence['realModels']['v4HistoricalCalls']==12
parser=argparse.ArgumentParser(description='Render the evidence-scoped v5 technical PDF, no network or video generation.')
parser.add_argument('--font',default='C:/Windows/Fonts/msyh.ttc',help='Installed, appropriately licensed CJK TTF/TTC; do not copy proprietary font files into source packages.')
args=parser.parse_args()
pdfmetrics.registerFont(TTFont('GX',args.font))
OUT=ROOT/'output/pdf';OUT.mkdir(parents=True,exist_ok=True)
DEST=OUT/('gongxu-zhiban-technical-v5-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.pdf')
if DEST.exists():raise RuntimeError('Refuse to overwrite a prior document')
INK=colors.HexColor('#241A34');MUTED=colors.HexColor('#64596F');PURPLE=colors.HexColor('#7040AA');RULE=colors.HexColor('#DAD0E7');TEAL=colors.HexColor('#146A6E')
styles={
 'body':ParagraphStyle('body',fontName='GX',fontSize=10.2,leading=18,textColor=INK,spaceAfter=11,wordWrap='CJK'),
 'small':ParagraphStyle('small',fontName='GX',fontSize=8.5,leading=14,textColor=MUTED,spaceAfter=9,wordWrap='CJK'),
 'title':ParagraphStyle('title',fontName='GX',fontSize=24,leading=33,textColor=INK,spaceAfter=15,wordWrap='CJK'),
 'sub':ParagraphStyle('sub',fontName='GX',fontSize=12,leading=20,textColor=PURPLE,spaceAfter=18,wordWrap='CJK'),
 'heading':ParagraphStyle('heading',fontName='GX',fontSize=13,leading=20,textColor=TEAL,spaceBefore=9,spaceAfter=9,wordWrap='CJK'),
 'cell':ParagraphStyle('cell',fontName='GX',fontSize=9,leading=15,textColor=INK,wordWrap='CJK'),
 'thead':ParagraphStyle('thead',fontName='GX',fontSize=9,leading=15,textColor=colors.white,wordWrap='CJK'),
}
story=[];chapters=[]
def p(s,kind='body'):return Paragraph(escape(str(s)).replace('\n','<br/>'),styles[kind])
def text(s,kind='body'):story.append(p(s,kind))
def heading(s):text(s,'heading')
def page(title,subtitle):
 if story:story.append(PageBreak())
 chapters.append(title);text(f'{len(chapters):02d}  /  ENGINEERING REVIEW','small');text(title,'title');text(subtitle,'sub')
def table(headers,rows,widths=None):
 t=Table([[p(s,'thead') for s in headers]]+[[p(s,'cell') for s in row] for row in rows],colWidths=widths or [499/len(headers)]*len(headers),repeatRows=1,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,1),(-1,-1),.5,RULE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F4F0F8'),colors.white])]))
 story.extend([t,Spacer(1,12)])
def diagram(rows):
 d=Drawing(499,len(rows)*82)
 for row,labels in enumerate(rows):
  y=d.height-60-row*82
  for col,label in enumerate(labels):
   x=col*174;d.add(Rect(x,y,145,48,rx=7,ry=7,fillColor=colors.HexColor('#F0E9F8'),strokeColor=RULE))
   for n,line in enumerate(label.split('\n')):d.add(String(x+11,y+30-n*14,line,fontName='GX',fontSize=10,fillColor=INK))
   if col<len(labels)-1:
    d.add(Line(x+150,y+24,x+168,y+24,strokeColor=PURPLE));d.add(Polygon([x+168,y+24,x+163,y+27,x+163,y+21],fillColor=PURPLE,strokeColor=PURPLE))
  if row<len(rows)-1:
   last=(len(labels)-1)*174+72;d.add(Line(last,y-3,last,y-15,strokeColor=TEAL));d.add(Line(last,y-15,72,y-15,strokeColor=TEAL));d.add(Line(72,y-15,72,y-29,strokeColor=TEAL))
 story.extend([d,Spacer(1,10)])
def architecture():
 d=Drawing(499,235)
 def box(x,y,a,b):
  d.add(Rect(x,y,145,48,rx=7,ry=7,fillColor=colors.HexColor('#F0E9F8'),strokeColor=RULE))
  d.add(String(x+10,y+29,a,fontName='GX',fontSize=10,fillColor=INK));d.add(String(x+10,y+13,b,fontName='GX',fontSize=9,fillColor=INK))
 def arrow(x,start,end):
  d.add(Line(x,start,x,end+5,strokeColor=PURPLE));d.add(Polygon([x,end,x-3,end+5,x+3,end+5],fillColor=PURPLE,strokeColor=PURPLE))
 box(174,182,'React / TypeScript','Vite · 项目工作区');box(174,100,'Fastify / Node.js','认证 · AI编排 · 状态检查');arrow(246,178,152)
 d.add(Line(246,96,246,78,strokeColor=PURPLE));d.add(Line(72,78,420,78,strokeColor=PURPLE))
 box(0,10,'本地Embedding','独立可替换向量服务');box(174,10,'PostgreSQL / pgvector','业务 · 作业 · 向量检索');box(348,10,'聊天模型API','仅服务端 · 凭据隔离')
 for x in [72,246,420]:arrow(x,78,62)
 story.extend([d,Spacer(1,10)])

page('工序智伴','AI原生软件工程实训智能平台 · 技术评审稿 v5')
story.append(Spacer(1,27));text('让需求变化后，工程证据仍能对得上。','title')
text('面向高职软件工程实训，把AI候选、知识来源、人工审核与实际记录组织在同一确认需求版本下。')
diagram([['确认需求\n保留完整原文','审核计划\n任务与验收方法','设计测试\n关联当前修订'],['登记证据\n如实记录未执行','变更复核\n旧结果不冒充新','交付检查\n指出剩余缺口']])
text('传智杯 AI WEB 网页开发挑战赛 · 拟报C组\n2026年11月1日 · 本地研发成果，尚未提交','sub')
text('团队姓名、学校、学籍、分工及指导教师待参赛者真实填写。依据仅为用户提供七张截图的清晰可见条款，未获得完整评分权重或国赛细则。','small')
text('真实性边界：v4已有12次真实模型响应；本轮新增收费调用0次。新长需求规划完成真实数据库与浏览器联调，模型使用协议替身；真实生成质量与独立人工审核待完成。','small')

page('问题、用户与应用价值','将“生成内容”与“工程已验证”区分开')
text('实训中，学生经常能够写出局部功能，却难以维护需求、任务、测试与技术文档的一致性。需求新增权限条件后，旧计划和旧通过记录仍可能被误用于当前交付。')
table(['场景','平台提供的帮助','仍由人承担'],[['需求不明确','保存、分析与确认版本；保留原文','目标、验收条件和适用范围判断'],['任务脱节','Agent规划、条件关联、知识来源','计划是否覆盖真实需求'],['结果误读','明确模型建议、人工关联与执行记录','实际执行与证据真实性'],['需求发生变化','版本影响、历史查看与当前缺口','是否重新开发、测试和更新文档']],[90,205,204])
heading('原创应用主线')
text('围绕“需求变化容易让验证证据失效”组织已有功能。采用版本、修订、来源和人工决策约束AI输出，不依靠新增页面或装饰动画来说明创新。')
text('目标是让学生能解释每次交付的依据；目前没有真实教学效果、用户满意度或能力提升比例。试用与教师审核方案已准备，参与者尚未招募。')

page('需求分析与范围','P0稳定闭环，P1效果证据，P2有边界的扩展')
table(['优先级','已实现范围','未完成/待验证'],[['P0','项目、确认需求、Agent、RAG、代码诊断、人工测试、文档与追踪','正式仓库评审权限及提交材料'],['P0可靠性','请求归属、未保存保护、定义/执行独立修订、版本隔离','长期多人负载尚未验证'],['P1','长需求持久规划、合并审核、当前缺口和下一步','真实长需求模型质量、人审与试用'],['P2','保留接口扩展点','OCR、自动执行沙箱、多模态/MCP不在本轮实现']],[78,220,201])
text('本轮桌面Web为主，保留既有兼容能力。截图的“含PC端Web、移动端Web等”未显示强制同时实现两端；没有据此删除现有布局或新增手机开发。')
heading('验收原则')
text('每项改进对照源码、回归、实际环境或材料证据。接口返回、ID完整和工具成功都不等于模型语义正确；没有运行的层级写待执行，不跨层累加通过率。')

page('系统架构与技术选择','保持原技术栈，不引入平行系统')
architecture()
table(['选择','原因与边界'],[['React/TypeScript/Vite','复用成熟组件、类型与按需加载，核心业务围绕当前项目与版本。'],['Fastify/PostgreSQL','利用现有路由与事务锁维护并发一致性；持久化作业支持中断核对。'],['pgvector + 独立Embedding','关系数据与向量同库易管理；本地模型降低额外调用成本，聊天接口不充当向量接口。'],['可配置模型适配器','应用既有配置不被评测覆盖；模型密钥不进入前端、作业快照或源码包。']],[140,359])
text('新增long-plan模块复用现有认证、模型调用、检索与项目状态。没有新增应用运行时依赖，没有为了术语添加MCP连接或不必要的外部服务。','small')

page('数据模型与一致性','原结构继续使用，022仅增量扩展')
table(['数据层','主要记录','一致性约束'],[['项目与需求','账号/项目/确认版本/原文','归属核验、版本前置条件、项目锁'],['任务与测试','任务、用例定义修订、执行修订','双窗口冲突409，历史不可代替当前'],['追踪与文档','条目、建议/人工关联、执行说明、文档修订','同版本、同修订、人工复核'],['长需求方案','原文范围、SHA-256、原子条件、方案修订','全文覆盖、审核失效与历史'],['持久作业','片段、尝试、原始输出、用量、事件、合并审核','请求幂等、租约、版本检查、事务采纳']],[95,200,204])
text('022不删除旧业务数据或历史。原v4独立执行修订、任务书草稿保护、快捷导航独立目录已存在，本轮先验证，不重复计为新增实现。')
text('两个窗口用同一用例定义版本登记结果时，还须携带执行修订；后提交的旧结果被拒绝。需求、方案或合并草案改变后，旧审核不能直接采纳。')

page('AI Agent与人工协作','实际工具和状态可追查，不展示伪造思考过程')
diagram([['确认输入\n当前需求与归属','检索依据\n实际片段原文','生成候选\n任务/验收/依赖'],['检查结果\n结构与缺项','人工审核\n依据与语义','正式采纳\n待办任务与建议']])
text('普通需求保留现有Agent运行、工具调用和取消恢复流程。长需求新增专用作业，但仍回到同一正式任务与追踪模型。')
table(['行为','可观察结果'],[['生成失败或超时','保留错误及已完成部分，不显示完成百分比。'],['检索没有依据','明确无来源，不编造引用；来源存在仍需核对支持关系。'],['人工采纳','事务复核当前版本及修订，重复点击不重复建任务。'],['取消或重启','停止后续请求，不保证撤销提供方处理或计费。']],[135,364])
text('这是编排、状态约束与人机协作的工程实现，不宣称自主完成任意开发或新训练模型算法。')

page('长需求：可审计拆分','先保留全部原文，再审核语义单位')
text('存储上限50000个UTF-16代码单元不变；原单次20000安全边界保留。新入口默认4000一段，每段最多6000、最多20段，保留半开原文范围和哈希。emoji不会从代理对中间切开。')
table(['审核内容','处理规则'],[['原文覆盖','片段连续覆盖全文；原子条件覆盖全部非空原文，尾部不能丢失。'],['稳定标识','同项目和相同原文范围/内容保持标识；修改范围重新生成。'],['原子验收与上下文','人工分类并记录简述；未分类不能通过方案审核。'],['跨段与重叠','完整条件进入相关片段，跨段依赖与重复范围必须说明。'],['方案修改','新增修订与历史，相关审核立即失效。']],[140,359])
text('原文覆盖检查不能证明自然语言含义已拆对。人需要判断一段是否包含多个条件、是否存在隐含前提和冲突。原v4只读分段审阅继续保留。')

page('长需求：持久化执行','有界队列、可恢复结果与明确的费用不确定性')
table(['控制','已实现行为'],[['容量','全局同时1段，队列活动作业最多8，同账号最多2。数据库锁协调多个工作器。'],['请求记录','发送前保存尝试；固定需求/方案/提示词/模型快照，密钥不进入记录。'],['片段结果','保存任务、验收、关联、来源、未决问题、原始回答和返回用量。'],['超时/断连/取消','状态不确定，停止后续请求；不会自动重试或假报未收费。'],['人工重试','显式理解可能重复费用，最多3次，有限退避；成功片段不重复生成。'],['服务重启','旧工作器记录暂停，读取不触发调用，人工核对后主动恢复。']],[130,369])
text('纯空白片段记录为原文保留，不需要模型伪造任务。输出截断及无效JSON保留原始回答，不记为完整候选。单段提示超预算时调用前明确阻止，不静默截断。')

page('长需求：合并与采纳','结构完整不等于语义完整')
text('每段给出候选任务、阶段、描述、验收方法、条件关联、来源和未决问题。全局保留原始分段结果、合并草案和每次修改。')
table(['检查','对应人工动作'],[['遗漏与重复','检查验收条件漏项、重复标题与候选重叠；不得只看ID齐全。'],['依赖与冲突','检查跨段依赖、循环以及启发式冲突提示；全文含义仍需人工核对。'],['来源支持','展示真实检索原文，逐项判断是否足以支持任务或结论。'],['任务预算','正式计划最多80个任务，超出时人工合并，不能丢掉后半部分。'],['版本采纳','审核后仍在事务内复核确认需求、方案修订、草案哈希与作业修订。']],[130,369])
text('人工纠正片段明确标为human_correction，保留旧模型尝试。正式任务仍为待办，关联仍是建议；本轮不自动确认用例、执行或交付。')

page('需求到验证证据的闭环','变化后重新核对，不把历史通过带到新版本')
diagram([['需求条目\n原文与版本','任务\n建议/人工关系','测试用例\n定义修订'],['执行记录\n独立修订与说明','变更影响\n失效与待复核','交付依据\n当前版本口径']])
text('追踪视图显著显示缺任务、缺用例、待确认关系与缺执行证据。高级审核按需展开，保留填写内容，用户主动作出每个决定。')
text('用例编辑重置相关执行状态并保留历史；旧版通过、旧关联和旧文档只能作为历史参考。项目概览、测试统计和交付检查使用一致的当前确认版本。')
text('本平台没有执行被测设备借用系统。合成流程中的“通过”不能冒充真实业务执行，正式演示采用未执行/阻塞或明确说明联调范围。人工结果也不能写成平台自动验证。')

page('RAG知识与来源','文档、向量和聊天调用职责分离')
diagram([['上传PDF/文本\n校验大小与类型','解析与分块\n原文位置','独立Embedding\n本地或可替换服务'],['pgvector索引\n模型兼容校验','账号内检索\n实际候选原文','知识增强回答\n来源/依据不足']])
text('已有本地向量引擎与队列继续使用。索引、检索和Agent调用共同受容量、超时、取消与有限重试约束；不同模型的旧向量不会假报当前可用。')
text('无命中、候选存在但依据不足、正常引用分别展示；模型不得引用检索中不存在的ID。引用有效只证明来源可追溯，不证明原文支持结论。')
text('上传资料中的指令作为不可信内容处理。单条恶意资料案例未服从攻击不等于防住所有提示注入。PDF扫描件OCR、任意资料自动授权共享不在当前范围。')

page('审查、测试、文档与成长','每种输出都标明证据层级')
table(['模块','实际功能','限制'],[['代码审查','语法检查、AI风险建议、来源快照、保存草稿','已检测事实与建议分开；不任意执行上传代码'],['测试中心','用例、边界与异常设计、版本筛选、人工执行登记','自动测试生成不等于实际执行；无外部代码沙箱'],['文档中心','生成、编辑、导出、修订冲突保护、上下文原文','资料超预算明确阻止，长上下文分段未接通'],['成长中心','真实任务、错误及当前版本进度','不是能力评分或已证明的教学提升']],[90,222,187])
text('长需求规划已接通，不扩大为“所有模块都支持长需求”的宣传。测试、文档和结合需求的代码审查继续保留原安全边界。')
text('保留原有真实业务逻辑；本轮没有重新制作页面来替代质量，也没有添加模拟统计。')

page('桌面交互与动效','让下一步可见，让高级审核可收起')
text('复用深色工作台、按钮、侧栏与编辑保护，不更换框架。方案、作业、合并审核按顺序展开；候选任务先以可读文字展示，原始JSON放在高级编辑中。')
table(['交互问题','处理与验收'],[['慢请求与切换','请求归属、卸载保护、版本校验；晚到结果不抢页面。'],['未保存内容','保存/放弃/取消，失败继续留在原内容；不只依赖beforeunload。'],['错误草案','字段类型错误也保留草案，不让React渲染崩溃；不能带错采纳。'],['状态反馈','180ms透明度/3px位移；减少动态效果时关闭；无伪进度。'],['键盘与布局','原生details、明确标签和焦点样式；桌面多宽度与缩放回归。']],[125,374])
text('Edge受控浏览器100组、axe25个场景自动检查无违规规则；自动工具仍留人工检查项。原生菜单缩放、辅助技术与长期低配体验未全部验收，不用构建通过代替视觉验收。')

page('实际界面：人工采纳后','隔离真实数据库、HTTP和Edge；模型为明确的协议替身')
image_path=ROOT/'docs/screenshots/review-v5/adopted-desktop.png'
with RasterImage.open(image_path) as raster:iw,ih=raster.size
im=Image(str(image_path),width=499,height=499*ih/iw)
story.extend([im,Spacer(1,12)])
text('此图来自v5实际浏览器联调的35字符小型合成项目，用来检查完整采纳交互。绿色反馈只说明计划采纳成功，任务仍待开始，关联仍需到追踪区核对；没有自动新增测试执行记录。','small')
text('49,781字符业务案例另经真实工作器、HTTP与数据库完整传递，模型仍为替身。此图不冒充该长案例的真实模型生成，也不包含真实账号或个人资料。','small')

page('真实模型证据与人工审核','已有12次真实调用，本轮不新增收费调用')
table(['证据','已取得','不能据此证明'],[['v4实际响应','12次真实DeepSeek响应 + 3条策略阻止','不是12项质量全部通过'],['用量与时间','42620输入/3450输出tokens；请求累计25430ms','费用估算非账单；耗时非学生任务时间'],['离线审核包','原始回答、合成输入、原文引用、匿名编号、空表','AI准备的条目不是专家已审核标准'],['独立人工审核','未完成，人工修改量为null','不报告可信提升百分比或教学成效']],[105,218,176])
text('保留普通问答表现更好的末尾条件案例。历史组仅回放提示词，不是完整旧系统；模型无不可变版本、每输入只跑一次、固定合成检索资料，外推能力有限。')
text('审核者分别判断遗漏、引用支持、正确/错误拒答、错误回答和实际修改量；分歧与无法判断保留。组织者映射与审核者包分开。新长需求真实质量按用户决定待验证。')

page('原创长需求案例与评测准备','业务结构、跨段条件和冲突，不靠重复字符凑长度')
text('campus-practice-v5.1：49,781 UTF-16字符，10章、96段、默认13个片段。涵盖设备预约、审批、库存、维护、版本、任务、测试、文档、账号与交付，包含80个正常/异常恢复业务案例。')
table(['边界','协议验证与后续人审'],[['末尾条件','禁止普通学生自审批、失败不扣库存与emoji完整进入末段请求。'],['跨段要求','原子条件跨片段时携带完整原文，并给出跨段说明。'],['冲突资料','7天规则与未批准14天草案需要人工确认依据；不能自动消除冲突。'],['版本变化','换版后旧作业不能采纳，历史保留。'],['服务失败','取消、超时、429、重启保留记录，不自动产生新收费。']],[125,374])
text('当前证明的是输入传递、状态约束与恢复，不是模型理解质量。合成案例仍有重复的业务结构，不等于真实课堂需求样本。后续由真实审核者核对条目与来源，再另行批准付费验证。')

page('测试证据与复核入口','不同层级分别记录，不能相加为全系统通过率')
table(['层级 / 实际入口','本轮结果','边界'],[['pnpm verify','15步；API134、向量4、根JS81、Python8分别通过','单元与协议替身；无收费'],['verify --suite=browser','4步；Edge100场景，生产资源恢复及首屏测量通过','受控API，不是实际模型'],['verify --suite=accessibility','25场景、0工具违规规则','保留人工检查项'],['verify --suite=database','18步通过；包括22迁移、版本/并发/检索等','真实本地数据与向量；聊天替身'],['long-plan-local --browser','16组通过，浏览器到隔离数据库采纳','真实HTTP/SQL/Edge；聊天替身'],['独立副本安装','355包下载、复用0；离线15步与空库4组通过','本机运行时；跳过安装脚本']],[169,170,160])
text('命令、报告路径、哈希和失败修复保留于docs/verification/review-v5.json及CONTINUATION-V5。页面崩溃回归先复现再修复，打包白名单回归先失败再修复；未删除测试或弱化业务断言。','small')

page('启动、迁移与交付恢复','本地可运行不等于公网已部署')
text('Node.js 22+与锁文件依赖；PostgreSQL/pgvector使用现有方案，聊天与Embedding配置相互独立。源码包不含实际.env、凭据、业务数据、依赖目录和模型权重。维护者只在本地配置凭据。')
table(['步骤','可复核说明'],[['安装与构建','pnpm install --frozen-lockfile；pnpm verify。独立副本验证使用新存储但跳过依赖安装脚本，不能当完整新机器验证。'],['数据库迁移','构建API后运行其dist/migrate.js；001—022空库/重复迁移已检查，不通过清库解决兼容。'],['本机启动','pnpm start:local -Database external；API改动后配合-RestartApi；检查health/ready。'],['中断恢复','作业暂停，成功段保留；不确定请求先核对，主动恢复才继续。'],['回退与外部操作','保护历史和新增数据；不重置Git或删表。公网部署/推送/提交另需授权。']],[120,379])

page('比赛截图逐项验收','只按七张可见条款；不编造评分权重')
table(['条款与性质','本轮状态','剩余要求'],[['AI Native Web / 现代框架','部分满足；真实Web和工程流程可核对','语义质量、人审和实际价值仍需证据'],['原创 / 深度AI应用','部分满足；原创业务与第三方声明分开','最终原创性及完整规则确认'],['C组资格 / 队伍人数','信息不足','真实学籍、1—3同校学生、≤2教师'],['代码仓库 / Git / README','部分满足；本地历史和源码包保留','评审可访问仓库、团队资料'],['视频5—8分 / 1080p MP4','部分满足；本轮只有7分钟稿与提纲','用户自行录制普通话正式成片'],['技术PDF≤30页及章节','章节/页数/渲染可核对；整体部分满足','团队和独立效果审核待补'],['公网演示：可选加分','不满足，未部署','另行授权、评审账号与可用性'],['官网提交 / 规则缺失','尚未提交；裁切及权重信息不足','正式入口、回执、完整同届规则']],[145,175,179])
text('截图省赛报名/提交日期为2026-11-18，未见具体时分或国赛独立要求。在线演示是可选加分；多模态/MCP是背景与推荐，不为术语强行添加功能。','small')

page('参考、许可与原创说明','通用问题解决思路可以借鉴，成果不能冒用')
text('沿用v4已核验的公开案例记录，没有重新下载或复制其他作品。河南轻工职业学院2026-06-12报道可确认第八届AI WEB C组作品省一、国三；不是国一。另有院校国一线索，但国赛组别与作品材料不完整，不据此推演获奖原因。')
story.append(Paragraph('<link href="https://rgznxy.havcli.edu.cn/info/1714/1724.htm" color="#7040AA">河南轻工职业学院原报道</link>',styles['body']))
story.append(Paragraph('<link href="https://xxgcx.fjmzw.com/_t13/2026/0616/c722a114178/page.htm" color="#7040AA">湄洲湾职业技术学院展示材料</link>',styles['body']))
text('本项目借鉴的是围绕垂直问题组织完整流程的通用思路，独立实现需求版本、分段作业、人工审核、修订冲突及交付证据。没有复制案例代码、文案、素材、品牌或特色界面，不把往届规则用于本届验收。')
text('本轮没有新增应用运行时第三方依赖或素材。既有前端依赖及星环保留THIRD-PARTY-LICENSES与vendor NOTICE；它们是第三方组件，不作为自研AI创新。技术文档使用本机字体渲染，不将字体文件打入源码包。')
text('原创实现与验证入口：apps/api/src/long-plan、apps/web/src/components/LongRequirementPlanning.tsx、022迁移、相关回归及既有trace模块。工程应用创新不等于新模型算法。')

page('总结与待完成事项','交付的是可恢复成果和明确边界')
text('本轮把长需求从只读审阅推进到可审计拆分、持久生成作业、全局审核及正式任务采纳。失败、费用不确定和版本失效都有可追查状态；原业务和v4可靠性成果保留。')
table(['顺序','下一步','所需条件'],[['1','独立审核12份已保存真实响应，填写引用与遗漏判断','真实审核者参与；不需要新增调用'],['2','审核长案例拆分，验证真实分段模型质量','新的明确调用/费用/数据授权，本轮不执行'],['3','录制正式视频，补团队/资格与仓库评审访问','用户录制与真实资料；外部操作另行确认'],['4','评估测试/文档长上下文和课堂容量','后续范围与实测依据，不承诺已完成']],[45,270,184])
text('独立交付：新版本脱敏源码ZIP、真实响应审核包、技术PDF、中文逐字稿及一页操作提纲。旧包、历史和真实数据保留；源码包不含.git，不能替代正式比赛仓库。')
text('不保证获奖，不把自评达标当作评审认可。完整验收矩阵仍有部分满足、待验证和信息不足，下一步按真实证据推进。','sub')

def footer(c,doc):
 c.saveState();c.setStrokeColor(RULE);c.line(48,48,547,48);c.setFont('GX',8);c.setFillColor(MUTED);c.drawString(48,33,'工序智伴 / 技术评审稿 v5 / 2026-11-01');c.drawRightString(547,33,f'{doc.page:02d}');c.restoreState()
doc=SimpleDocTemplate(str(DEST),pagesize=(595.28,841.89),rightMargin=48,leftMargin=48,topMargin=57,bottomMargin=66,title='工序智伴 v5 技术评审稿',author='工序智伴项目',subject='工程实现与证据边界；新长需求真实模型质量待验证')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
count=len(PdfReader(str(DEST)).pages)
if count!=len(chapters) or count>30:raise RuntimeError(f'Layout needs correction: {count} pages for {len(chapters)} chapters')
manifest={'edition':'v5','pdf':str(DEST.relative_to(ROOT)).replace('\\','/'),'pages':count,'chapters':chapters,'bytes':DEST.stat().st_size,'sha256':hashlib.sha256(DEST.read_bytes()).hexdigest(),'visualReview':'pending_render_and_inspection','evidenceIndex':'docs/verification/review-v5.json','realModelCallsThisRound':0,'historicalRealModelCalls':12,'teamInfo':'pending_user','submitted':False}
(DEST.parent/(DEST.stem+'-manifest.json')).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pdf':str(DEST),'pages':count,'bytes':DEST.stat().st_size,'visualReview':'pending'},ensure_ascii=False))
