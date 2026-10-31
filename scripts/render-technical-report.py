"""Render the original, evidence-scoped competition technical review document.

Requires reportlab and pypdf. Uses an installed CJK font; font files are not copied
into the repository. No environment configuration, business data or network access.
"""
from pathlib import Path
from xml.sax.saxutils import escape
import argparse, json
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Image
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--font',default='C:/Windows/Fonts/msyh.ttc')
parser.add_argument('--screens',default='docs/screenshots/review-v3')
args=parser.parse_args()
pdfmetrics.registerFont(TTFont('GX',args.font))
OUT=ROOT/'output/pdf';OUT.mkdir(parents=True,exist_ok=True)
DEST=OUT/'gongxu-zhiban-technical-v3.pdf'
INK=colors.HexColor('#211A32');MUTED=colors.HexColor('#62596F');PURPLE=colors.HexColor('#703EB8');TEAL=colors.HexColor('#156E70');RULE=colors.HexColor('#DAD2E5')
styles={
 'body':ParagraphStyle('body',fontName='GX',fontSize=10.2,leading=18,textColor=INK,spaceAfter=11,wordWrap='CJK'),
 'small':ParagraphStyle('small',fontName='GX',fontSize=8.5,leading=14,textColor=MUTED,spaceAfter=8,wordWrap='CJK'),
 'title':ParagraphStyle('title',fontName='GX',fontSize=25,leading=35,textColor=INK,spaceAfter=15,wordWrap='CJK'),
 'sub':ParagraphStyle('sub',fontName='GX',fontSize=12,leading=19,textColor=PURPLE,spaceAfter=18,wordWrap='CJK'),
 'h3':ParagraphStyle('h3',fontName='GX',fontSize=13,leading=20,textColor=TEAL,spaceBefore=11,spaceAfter=8,wordWrap='CJK'),
 'cell':ParagraphStyle('cell',fontName='GX',fontSize=9,leading=15,textColor=INK,wordWrap='CJK'),
 'thead':ParagraphStyle('thead',fontName='GX',fontSize=9,leading=15,textColor=colors.white,wordWrap='CJK'),
}
story=[];chapters=[]
def p(text,kind='body'):return Paragraph(escape(text).replace('\n','<br/>'),styles[kind])
def text(s,kind='body'):story.append(p(s,kind))
def table(headers,rows,widths=None):
 data=[[p(x,'thead') for x in headers]]+[[p(str(x),'cell') for x in row] for row in rows]
 t=Table(data,colWidths=widths or [499/len(headers)]*len(headers),repeatRows=1,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LINEBELOW',(0,1),(-1,-1),.5,RULE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F5F2F8'),colors.white])]))
 story.extend([t,Spacer(1,14)])
def page(number,title,subtitle):
 if story:story.append(PageBreak())
 chapters.append((number,title));text(f'{number:02d}  /  ENGINEERING REVIEW','small');text(title,'title');text(subtitle,'sub')
def heading(title):text(title,'h3')
def diagram(rows,sequence=True):
 d=Drawing(499,83*len(rows));w=145;h=48
 for row,labels in enumerate(rows):
  y=d.height-58-row*83
  for col,label in enumerate(labels):
   x=col*174
   d.add(Rect(x,y,w,h,rx=7,ry=7,fillColor=colors.HexColor('#F1EAF8'),strokeColor=RULE,strokeWidth=.7))
   for k,line in enumerate(label.split('\n')):d.add(String(x+12,y+h-19-k*14,line,fontName='GX',fontSize=10,fillColor=INK))
   if sequence and col<len(labels)-1:
    d.add(Line(x+w+5,y+h/2,x+168,y+h/2,strokeColor=PURPLE,strokeWidth=1.2));d.add(Polygon([x+168,y+h/2,x+163,y+h/2+3,x+163,y+h/2-3],fillColor=PURPLE,strokeColor=PURPLE))
  if sequence and row<len(rows)-1:
   # Continue from the last stage, rather than implying that stage one skips ahead.
   last_x=(len(labels)-1)*174+72
   d.add(Line(last_x,y-4,last_x,y-17,strokeColor=TEAL))
   d.add(Line(last_x,y-17,72,y-17,strokeColor=TEAL))
   d.add(Line(72,y-17,72,y-29,strokeColor=TEAL))
   d.add(Polygon([72,y-34,69,y-28,75,y-28],fillColor=TEAL,strokeColor=TEAL))
 story.extend([d,Spacer(1,10)])

def architecture():
 d=Drawing(499,240)
 def box(x,y,title,detail):
  d.add(Rect(x,y,145,48,rx=7,ry=7,fillColor=colors.HexColor('#F1EAF8'),strokeColor=RULE,strokeWidth=.7))
  for offset,label in [(29,title),(13,detail)]:d.add(String(x+12,y+offset,label,fontName='GX',fontSize=9.5,fillColor=INK))
 def arrow(x,y,end):
  d.add(Line(x,y,x,end+6,strokeColor=PURPLE,strokeWidth=1.2))
  d.add(Polygon([x,end,x-3,end+6,x+3,end+6],fillColor=PURPLE,strokeColor=PURPLE))
 box(174,182,'React / TypeScript','Vite · 状态与编辑保护')
 box(174,100,'Fastify / Node.js','鉴权 · 校验 · Agent工具')
 box(0,10,'本地Embedding','BGE-small · CPU推理')
 box(174,10,'PostgreSQL / pgvector','版本 · 业务 · 向量索引')
 box(348,10,'聊天模型API','可替换 · 服务端凭据')
 arrow(246,178,152)
 d.add(Line(246,96,246,79,strokeColor=PURPLE,strokeWidth=1.2))
 d.add(Line(72,79,420,79,strokeColor=PURPLE,strokeWidth=1.2))
 for x in [72,246,420]:arrow(x,79,62)
 story.extend([d,Spacer(1,10)])

def source(title,url,detail):
 story.append(Paragraph(f'<link href="{escape(url)}" color="#703EB8">{escape(title)}</link>',styles['body']))
 text(detail,'small')
def screenshot(name,caption):
 path=ROOT/args.screens/name
 if not path.is_file():raise FileNotFoundError(f'Missing reviewed synthetic screenshot: {name}')
 im=Image(str(path));ratio=im.imageHeight/im.imageWidth;im.drawWidth=499;im.drawHeight=499*ratio
 story.extend([im,Spacer(1,8),p(caption,'small')])

page(1,'工序智伴','AI 原生软件工程实训智能平台')
story.append(Spacer(1,45))
text('让需求、任务与验证证据保持同一条线。','title')
text('面向高职软件技术实训，把大模型生成、知识检索、实际工具记录和人工审核组织成可追溯的工程流程。')
story.append(Spacer(1,24))
diagram([['提出需求\n保留原文与版本','生成计划\n检查结构与依据','人工审核\n确认任务与关联'],['设计测试\n锁定用例修订','登记执行\n保留说明与历史','文档交付\n标记依据变化']])
text('传智杯 AI WEB 网页开发挑战赛 · C组拟参赛作品\n技术评审稿 v3 · 2026年11月1日','sub')
text('团队姓名、学校与指导教师待参赛者真实填写。本稿没有使用虚构身份、用户反馈或获奖承诺。','small')
text('真实性声明：本轮使用真实本地数据库、向量推理和浏览器联调；聊天模型验证采用明确替身。真实付费模型效果及完整三流程对比尚待授权执行。','small')

page(2,'问题与产品边界','从“获得答案”走向“能够核对工程过程”')
heading('真实学习困难')
text('学生能够提出项目想法，却常在需求澄清、任务拆分、错误定位、测试设计和交付文档之间失去连续性。单次聊天难以回答：这项任务来自哪条需求？这个通过结果针对哪个版本？需求改动后还有哪些成果可用？')
heading('本项目的处理方式')
text('以项目与确认需求版本为共同上下文。模型产物先成为待审核建议；任务和用例关联由人确认；执行结果单独登记；文档记录生成时的依据快照。核心目标是降低工程过程中的遗漏与归属错误，而非替学生声明任务已经完成。')
table(['能力','已实现的范围','不能据此推断'],[['AI辅助','需求分析、规划、RAG回答、审查建议、测试与文档生成接口','新提示词真实模型质量尚未评测'],['工程可靠性','请求归属、修订冲突、审核历史、取消与超时','不能替代上线安全审计'],['学习记录','按账号真实操作与人工结果汇总','不是学生能力成绩或教学成效证明']],[80,235,184])
text('平台不执行用户提交的任意代码；确定性代码诊断限于 JavaScript / TypeScript 语法。人工“通过”表示用户登记的结果，必须结合说明核对。','small')

page(3,'竞赛要求对照','只采用七张截图清晰可见的条款，不自拟评分权重')
table(['截图要求','当前状态','依据及待补'],[['原创Web、AI为核心','部分满足','原创工程流程已实现；第三方许可与真实AI效果分别核对'],['现代前端、AI集成、创新、UX考察','部分满足','React/TS/Vite；本地流程与浏览器回归；无官方分值换算'],['C组及团队资格','信息不足','用户拟报C组；学籍、1-3名同校学生与≤2名教师待核验'],['GitHub/Gitee与完整Git历史','部分满足','保留本地真实阶段提交；远程评审访问待确认'],['README、运行与环境说明','部分满足','代码、模板、锁文件、迁移和验证说明可复核；团队资料待填'],['5-8分钟1080p普通话MP4','部分满足','已有6:18、1920×1080工程草稿；聊天替身，正式真实模型演示与听审待完成'],['≤30页技术PDF','已实现待最终验页','本稿覆盖技术、核心实现、测试部署、创新及限制'],['公网演示','不满足（可选加分）','当前本地版本；未越权部署、上传或提交']],[136,105,258])
text('缺失信息：评分权重、国赛完整规则、图1页首和图7底部等裁切内容、完整后续提交注意事项。截图中的2026年11月18日属于省赛安排；本轮研发截止为11月1日12:00。两者不可混同。','small')
text('截图将PC Web、移动Web列为形态示例，未见强制同时开发双端。本轮专门优化电脑网页版，保留已有窄屏兼容。','small')

page(4,'需求与验收设计','把功能输出转换为可以检查的行为')
table(['场景','关键行为','验收方式'],[['需求编辑','迟到项目响应不覆盖当前编辑；保存目标绑定原项目','A→B→A、慢网乱序、失败恢复与前进后退'],['长需求','原文可存5万字符；生成超过2万明确拒绝','关键条件置于尾部；不得输出似乎完整的截断产物'],['任务规划','检索→生成→规则检查→人工采用','真实步骤、工具结果、失败与跳过均留存'],['证据追踪','条目、任务、用例和当前修订明确关联','新版本不继承旧通过结果；配对修改留历史'],['文档编辑','修订号防覆盖，生成依据变化可见','并发同修订仅一方成功；409后保留本地内容'],['交付记录','依据更新需重新核对；存储失败不丢草稿','失败时取消离开，恢复后保存继续']],[85,215,199])
heading('优先级')
text('P0：可运行环境、数据归属、版本一致、Agent实际执行记录、RAG来源、真实状态和核心编辑保护。P1：任务验证链、文档来源快照、历史核对、可复核评测与桌面可访问性。P2：多Agent自治、OCR、外部代码安全沙箱等扩展；本轮不冒险加入。')

page(5,'产品功能与路由','复用同一项目上下文，不堆叠独立聊天页面')
diagram([['工作台\n/dashboard','项目与需求\n/projects/:id','Agent规划\n…/agent'],['知识库\n/knowledge','代码审查与测试\n…/reviews · …/tests','项目文档\n…/documents'],['运行回看\n/runs','交付核对\n/delivery','成长记录\n/growth']],sequence=False)
heading('主线')
text('项目想法形成可编辑需求；确认版本后才进入规划和测试生成。生成的任务引用需求条目标识，知识检索记录可展开核对。审核者采用计划、确认关系，再登记测试执行。文档与交付检查读取同一版本的成果。')
heading('辅助入口')
text('实训任务库提供原创任务书和创建项目入口；快速导航帮助按页面、项目与操作定位。运行记录与交付清单提供回看和导出，保持原有API与权限边界。装饰星环支持主动开启和暂停，不参与AI能力判定。')
text('页面数量不作为创新证据。真正的可核对关系见第11-14页。','small')

page(6,'系统技术架构','前后端分离，聊天与向量服务独立配置')
architecture()
table(['选择','原因与代价'],[['React/TS/Vite','保留原技术栈，组件与状态可验证；按页加载较重视图'],['Fastify/Node.js','与前端共享语言生态，输入校验和路由注入测试清楚'],['PostgreSQL + pgvector','业务版本、审核和向量检索在同一关系库；需管理索引与数据备份'],['本地独立向量服务','控制持续成本；CPU容量有限，必须有界排队与超时'],['可替换聊天适配器','服务端配置模型，保持凭据隔离；不同供应商仍需实测能力与参数']],[140,359])
text('开发端口：Web 5173、API 3001、Embedding 3010。当前为本机环境，不等于公网部署或多实例高可用。','small')

page(7,'数据模型与增量迁移','保留旧内容，给新证据增加明确的来源字段')
table(['实体','核心关联与职责'],[['users / sessions / projects','账号会话与项目归属；先检查所有权再读写'],['requirement_versions / requirement_items','确认版本、原文条目、稳定key、字符位置和变更关系'],['agent_runs / steps / tool_calls','实际状态、模型、心跳、截止时间、工具输入输出摘要和人工审核'],['tasks / task_dependencies','计划来源、需求版本、任务依赖与人工任务状态'],['practice_test_cases / history','定义修订、人工结果与执行说明、历史快照'],['trace_links / task_test_links','需求关联与明确任务-用例配对，分别保存审核与修订'],['project_documents / history','文档正文、修订号、历史内容、生成依据快照'],['requirement_evidence_state','任务/用例/关系/文档变更序号；用于提示来源变化'],['knowledge_documents / chunks','账号归属、文档/页码/偏移、向量模型与维度']],[188,311])
text('迁移010-019为连续增量改动；018增加独立代码草稿，019保存审查来源快照。旧文档没有来源快照时保持未知；旧确认计划不补造人工审核；已有通过记录不跨版本复制。恢复代码时保留已应用迁移和真实数据，不以清库解决兼容。','small')

page(8,'Agent的实际执行流程','有限循环、持久状态与人工采用')
diagram([['校验确认需求\n长度与项目身份','检索专业资料\n所有需求分段','调用聊天模型\n产物为待审核JSON'],['结构/依赖/引用检查\n失败可纠正一次','完整性提示\n缺项/验收/依据','人工审核采用\n事务内创建任务']])
text('每个阶段实际写入运行、步骤或工具记录。未配置向量服务明确记为“跳过”；已配置但调用失败则记为失败，不伪造检索成功。输出结构最多允许30项任务；只有一项任务或零引用不直接判错，依据不足会进入人工检查提示。')
heading('恢复与重复请求')
text('心跳间隔15秒，超过90秒未更新或单次10分钟截止后，在读取时识别中断。取消保留完成步骤，迟到输出不能把运行改回成功。重新规划由用户主动发起，创建新记录；相同请求身份避免重复生成。')
text('这是一个有界、多阶段的Agent工作流，包含实际检索与规则工具，不宣称已实现多Agent自治。恢复读取不是独立后台调度器；取消不等于撤销供应商已经发生的计费。','small')

page(9,'RAG资料进入知识库','文档、页码、偏移与向量身份共同保留')
diagram([['PDF / TXT / Markdown\n大小与格式校验','提取可读文本\n保留PDF页码','按页分块\n默认1000/重叠150'],['持久保存\n待向量化状态','独立Embedding\n本地或兼容接口','向量写入\n模型/维度可核对']])
text('文本切块优先考虑邻近段落或句子边界；每块保存来源页码和字符位置。PDF文本解析不等于OCR，扫描件暂不支持识别。先保存和分块、后索引，可在向量服务未配置时继续其他工作。')
table(['边界','实际处理'],[['上传限制','前端PDF≤3MB、文本文件≤800KB，内容≤20万字符；服务端另有格式/载荷校验'],['模型替换','聊天与Embedding分别配置；DeepSeek聊天端点不当作向量接口'],['本地方案','固定版本BGE-small-zh-v1.5 ONNX量化，512维CPU推理；模型文件按清单核验'],['索引失败','显示失败并提供人工重试；旧成功片段不被伪装成新模型结果']],[105,394])

page(10,'RAG检索与并发控制','找到资料与资料支持结论是两件需要分别检查的事')
diagram([['问题或需求分段\n不丢末尾条件','独立向量排队\n忙碌/重试可见','pgvector检索\n限定账号/模型/维度'],['带原文的上下文\n资料只作为数据','模型增强回答\n引用实际片段ID','来源核对\n页码/原文/人工判断']])
text('同一服务地址共享容量控制，索引、检索和Agent不会各自无限并发。队列容量有界，等待包含超时和取消；只对适合重试的错误有限退避，429或不可用不会造成无限风暴。')
text('没有检索来源时不编造知识增强回答。冲突资料、恶意资料被作为不可信数据放入上下文；这项工程隔离已经协议测试，但真实模型是否正确处理冲突或抵抗注入，仍需真实评测。')
table(['已验证','未据此宣称'],[['真实本地Embedding并发索引/检索与账号隔离','真实多人课堂峰值容量、跨进程共享队列'],['受控429、服务失败、超时、取消及恢复','所有供应商的错误格式与计费行为'],['引用ID和原文可追溯','引用存在就证明结论正确']],[249,250])

page(11,'需求到任务及测试的追踪','稳定标识与显式关联，替代隐含的“应该覆盖”')
diagram([['确认需求版本\n保留完整原文','条目key与位置\n相同文字保持逻辑标识','任务/用例建议关联\n模型建议待人工审核'],['审核关联依据\n不自动改变测试结果','明确任务-用例配对\n记录用例当前修订','人工执行记录\n结果/时间/说明']])
text('原文条目按行确定性提取；超过200行合并连续范围，仍保留尾部内容。这是可追溯的文本定位机制，不宣称语义需求抽取已完整。修改文字后由人登记与旧条目的关系，历史证据不会继承。')
heading('完整证据链的最低条件')
text('需求条目、任务和用例属于同一项目及确认版本；两侧需求关联已经人工审核；任务-用例配对被明确确认；用例修订仍匹配；执行记录有时间、结果和说明。即使满足这些条件，也只表示存在可核对的人工证据，不是平台自动运行或证明软件正确。')
text('模型建议、人工确认关系、执行记录是三类不同数据。配对审核历史和用例历史分别保留，审阅者能够核对过去的判断。','small')

page(12,'需求变更的影响处理','旧结果保留，但不冒充新版本验证')
table(['事件','系统行为','审核者需要做什么'],[['确认新需求','新条目来源绑定新版本；历史任务/测试/文档可回看','审阅改写、移除、保留条目；新关系逐项确认'],['修改测试定义','修订递增；当前结果重置未执行；旧结果存入历史','按新步骤重新执行、填写说明、复核关联'],['修改已确认关联','保留前次审核；变更序号递增','重新核对涉及的任务验证链和文档'],['同版本执行结果变化','文档来源快照与当前序号不同','更新文档内容或重新生成，交付清单主动重核'],['人工编辑文档','创建新文档修订，保留生成时原始来源','不能用人工保存伪装“已用新依据重新生成”']],[108,195,196])
heading('重要取舍')
text('变更序号避免对大段正文反复全量计算，并能揭示同一需求版本的证据变化。它是来源新旧判定，不是语义正确性判断；覆盖应用现有写入路径，不宣称检测绕过应用直接删除数据库记录。')

page(13,'并发与未保存编辑保护','避免静默覆盖，比过渡动画更重要')
table(['风险','实现','验证'],[['跨项目迟到响应','请求取消/代次与响应归属校验；保存前复核编辑所属项目','快切、A→B→A、失败及浏览器历史'],['文档同时编辑','expectedRevision条件写入；缺省428、冲突409','真实DB并发仅一方成功；历史留存'],['保存时继续输入','保存快照与当前内容比较；离开前重新检查脏状态','晚到保存不收走新输入、不换回旧文档'],['页面或文档切换','保存/放弃/留在此页；失败不离开；焦点回到触发处','重复点击、Esc、Tab与返回导航'],['本机交付保存失败','内存草稿保留，页面/项目切换受保护，支持重试','模拟配额失败后恢复保存'],['自动刷新审核区域','同版本刷新保留草稿；版本改变暂停写入；失败显示只读','保存另一结果不卸载配对草稿']],[108,225,166])
text('代码草稿和新项目独立保存；保存并离开等待实际React提交后再核对新编辑。用例保存期间输入暂锁定。会话改变卸载旧工作区，正常退出仍先处理未保存内容。','small')

page(14,'审查、测试与文档生成','确定性检测、模型建议与人工结果分栏呈现')
heading('代码审查')
text('服务端解析器提供JS/TS真实语法诊断；AI建议仍待验证。审查可带入完整确认需求与实际检索原文，保存不可变来源快照；也可主动选择仅代码。代码草稿单独保存不调用模型。')
heading('测试中心')
text('按当前已确认需求展示正常、边界与异常用例，允许主动查看历史需求。结果由人登记，非“未执行”状态必须填写说明；旧修订请求不能覆盖新定义。相同内容保存保持已有结果与历史，只有真实定义变化才重置。')
heading('项目文档')
text('README、需求、设计、API、测试报告与总结使用共同项目上下文。生成前以单个可重复读数据库快照取得任务、测试和变更序号；模型调用前释放数据库连接。文档可编辑、导出、查历史和处理修订冲突。')
text('来源资料可能不足、模型可能遗漏、人工登记可能不准确。这些限制被放到可操作的审核界面，而不是用自动完成百分比掩盖。')

page(15,'权限、数据与恢复','本地验证不越过对外操作边界')
table(['边界','本轮做法'],[['凭据','仅供服务端读取既有环境配置；报告、截图与源码包不含真实.env或密钥'],['账号/项目隔离','先鉴权与校验所有权；关系外键绑定项目/版本；会话更换清除旧工作区内存'],['模型调用','本轮未进行收费调用；协议替身与历史真实报告明确分开'],['取消与限时','模型请求/响应体可中止；运行、步骤、工具仅允许进行中回写'],['数据库等待','运行时连接等待3秒，语句15秒，客户端18秒；迁移不套短业务超时'],['运行恢复','读取时识别过期运行，保留已完成步骤；不自动重放付费请求'],['交付与分享','不擅自推送/部署/上传/提交，不删除真实数据；评审包只处理副本']],[112,387])
text('部署前仍需评估HTTPS、会话存储、共享限流和多实例队列。当前队列与限流属于单进程方案，本轮不通过修改安全设置来伪装无人值守可用。','small')

page(16,'电脑工作台的阅读与交互','真实本地浏览器截图 · 合成账号与合成项目')
screenshot('task-test-chain-desktop.png','实际浏览器→本地API→PostgreSQL写入的任务验证链。模型为明确替身；截图不代表真实学生成绩。')
text('复用深空主题与现有组件：正文14px、辅助文字12px，保留大字号和紧凑显示偏好。需求条目导航在桌面滚动时保持可见，使审核者持续知道当前原文。')
text('按钮、焦点与展开反馈约180ms；不新增持续粒子或自动背景播放。减少动态效果设置提供静态替代，重要状态始终以文字表达。弹窗支持键盘与焦点恢复。')

page(17,'文档编辑与来源状态','真实界面保留修订、冲突与生成依据')
screenshot('documents-desktop.png','合成文档通过真实本地HTTP保存并读取修订历史；旧文档来源快照缺失时明确提示未知。')
text('生成来源是否更新、正文是否人工编辑、历史修订是什么，分别展示。冲突后本地内容保留，可核对服务器修订，再明确选择合并依据。恢复旧修订只进入编辑区，仍需主动保存。')
text('页面的深色外观不作为创新算法。视觉优化服务于版本辨识、长文阅读、错误恢复与稳定演示。','small')

page(18,'审查依据可回看','从代码片段延伸到项目需求与知识原文')
screenshot('review-source-desktop.png','实际本地向量检索、数据库来源快照与浏览器展示。聊天为替身；这里证明资料确实传入及可回看，不证明模型结论正确。')
text('审查绑定提交时的完整确认需求及实际检索片段。后续需求换版，旧审查标记历史；旧记录没有快照时明确显示未知。检索失败停止生成，不把没有检索到说成有知识依据。')
text('所有需求分段都有来源位置；超过20000字符明确阻止完整项目审查，只有主动选择仅代码才跳过需求。来源存在不等于语义支持，审核者仍需核对原文。','small')

page(19,'当前进度与历史记录分开','旧版本完成和通过，不能被当作新需求的验证')
screenshot('growth-current-desktop.png','真实本地数据库中的合成两项目：当前2项任务、0项完成；旧版本的人工通过/失败保留在历史活动中。')
text('成长中心按每个项目最近确认需求计算任务与测试；主动选择历史范围后才显示累计数量。历史视图不生成当前下一步建议，审查和最近活动始终明确标为历史，不把数量转成能力评分。')
text('任务状态更新在项目锁后再次核对需求版本。其他标签已确认新需求时，旧任务写入返回409且不新增事件；页面暂停旧看板，受未保存保护地重新读取项目。实际数据库锁竞争已验证。','small')

page(20,'首屏资源与排版失败恢复','减少不必要的初始下载，保持编辑器始终可用')
table(['P1阶段受控测量','拆分前','拆分后'],[['首页下载JS原始字节','458,518','292,487'],['入口构建gzip字节','144,421','91,944'],['三次列表可见时间 / ms','729 / 739 / 740','726 / 714 / 724'],['首页Markdown排版资源','包含在入口内','实际未请求，预览才加载']],[205,147,147])
text('同机Edge、1536×960、4倍CPU减速、回环HTTP、合成API、每版三个新上下文。资源减少166031字节；gzip为离线构建值，测试HTTP未启用压缩。本机少量时延样本不能证明所有用户加载速度提升。')
heading('失败路径同样需要可用')
text('排版资源下载中或失败时，页面显示完整转义原文，可继续编辑、复制和单独重试。加载完成后大纲重新建立。模拟慢加载、断网恢复和切项目三项检查均通过；HTML与外部图片继续禁止执行/请求。')
text('这是前端工程优化，不是新的AI算法。P1阶段构建、资源哈希及复核入口见PERFORMANCE-V3.md；后续小改动的产物以最终源码构建为准。','small')

page(21,'实际验证证据','阶段结果可复核；没有把旧基线当作本轮结果')
table(['命令/范围','本轮实际结果','证据性质'],[['API / Embedding','95项 / 4项通过','协议与业务回归；含修订、来源、队列和版本写入'],['受控浏览器可靠性','56组通过','Edge；所有API受控；含慢网、乱序、草稿和排版失败'],['本地DB/向量/桌面','21组通过','真实PostgreSQL、pgvector、本地Embedding；聊天替身'],['审查来源 / 成长任务','6组 / 6组通过','真实DB与HTTP；含检索原文、账号和确认版本锁竞争'],['Agent恢复与审核','8组通过','真实DB；中断、取消、重复请求、审核持久化'],['原有UI / 工作台','8组 / 11组通过','真实本地服务及明确标识的受控边界；不调用收费AI'],['构建与类型检查','通过','截图另已检查；不作为视觉验收的替代'],['评测准备与核算','18条输入记录','15条候选模型记录待执行，0条可比；不生成语义分数']],[155,105,239])
text('本页记录制作时已经执行的阶段证据，后续完整交付以docs/verification和最终报告为准。真实桌面检查包括1366×768、1536×864与CSS125%、1920×1080与CSS150%；CSS缩放不等于浏览器菜单缩放。','small')
text('未执行：完整屏幕阅读器/WCAG审计、原生菜单缩放、真实多人课堂峰值、真实模型三流程质量对比、学生试用和教师盲评。不能据已通过检查推断这些结果。','small')

page(22,'版本化效果评测准备','先固定输入、流程和判定方法，再讨论效果提升')
table(['案例','目的'],[['正常需求 / 末尾关键条件','检查需求覆盖，超长输入应完整处理或明确拒绝'],['需求变更 / 跨账号隔离','检查版本与所有权；以真实数据库/协议测试为依据'],['冲突资料 / 无答案资料','核对生效来源，不编造确定答案或引用'],['恶意资料 / 服务失败','数据与指令分离，有界失败与恢复；真实模型抵抗性待测']],[205,294])
text('eval:offline运行8类协议案例；eval:prepare捕获普通问答与当前生产流程输入，记录数据版本、源码状态、输入和提示词哈希。检索采用固定合成片段以控制变量，不冒充真实召回质量。优化前完整流程尚未安全复现，因此该组保持待执行。')
text('由两位审阅者独立判断原子验收条件覆盖/遗漏/不可判断，逐条核对引用支持，记录实质修改量与人工分钟数。失败、拒绝和未知项必须保留，不只统计成功回答。')
text('eval:report已通过8项离线核算回归：不同输入/资料/模型设置、缺双人判断或依据时不比较；15条候选记录仍待执行，0条可比。供应商用量缺失为null，不估算费用，不编造遗漏率或提升百分比。','small')

page(23,'创新与公开案例借鉴','工程与应用创新需要实现证据，不靠术语数量')
table(['本项目实现','可复核证据','边界'],[['版本驱动的工程协作','确认需求贯穿计划、测试、文档和交付','不声称发明新模型算法'],['人工审核与验证链','任务-用例显式配对、修订失效与历史','人工记录不等于自动代码验证'],['同版本来源快照','任务/测试/关系变化使文档和交付待复核','来源新旧不等于语义真实性'],['有界Agent与RAG协作','实际工具日志、容量队列、取消与人工恢复','非多Agent自治、非无限自动执行']],[145,197,157])
text('公开已核实案例：河南轻工职业学院2026年6月12日通报，第八届（2025-2026）AI WEB赛道C组《数智康护AI健康管理系统》获省赛一等奖、国赛三等奖。只借鉴垂直场景与闭环实用性，不能称其为国赛一等奖，也不以往届规则验收本项目。','small')
text('Triple-Y作者README自述第九届参赛，未核实获奖/组别；Little_World_Explorer缺少充分届次/奖项与许可证依据。本轮未复制这些项目代码、文案、素材或特色界面。','small')
text('既有星环适配SaturnWebGL（MIT）与Three.js；版权声明保留。它属于装饰组件，不列为原创AI算法。公开来源详见参考核验文档。','small')

page(24,'启动、迁移与交付','本机恢复流程与外部评审包分别管理')
heading('运行顺序')
text('准备Node.js 22+、pnpm和PostgreSQL/pgvector；按模板在本地配置API环境；安装锁定依赖；执行数据库增量迁移；启动API、网页和可选本地向量服务；先检查health/ready，再验证核心流程。启动探测不发起收费模型调用。')
text('Windows现有脚本：pnpm start:local -Database external；修改API后可加-RestartApi。迁移必须在真实配置下由程序读取，不能打印凭据。旧客户端缺少必要修订或审核字段会被拒绝，因此前后端需配套更新。')
heading('恢复原则')
text('阶段提交保留在原Git历史；恢复前检查他人未提交修改。回退自己的代码不等于逆向删除数据库列；保留012-019历史与新数据，再按兼容说明恢复。不得重置仓库或清空真实数据。')
heading('外部评审源码包')
text('保留源码、锁文件、配置模板、迁移、测试、评测脚本和报告。排除依赖目录、运行缓存、日志、Git目录、真实配置、数据库、模型权重、上传资料与未知敏感文件；只在打包副本脱敏。ZIP不能代替评审可访问且保留完整Git历史的比赛仓库。')

page(25,'剩余工作与验收结论','以证据范围收尾，不承诺获奖或虚构完工')
table(['优先级','待完成事项','处理边界'],[['P0 / 参赛资格','队员学籍、学校、人数、C组报名与教师资料','由参赛者真实确认，当前信息不足'],['P0 / 正式材料','真实AI演示、普通话5-8分钟1080p成片、仓库评审访问','本稿与演示草稿不代替最终提交'],['P1 / 真实评测','明确模型/次数/费用与合成数据传输授权；复现隔离基线','未授权不发起收费请求'],['P1 / 部署','公网评审版本、专用账号、监测与费用控制','截图为可选加分；部署需单独确认'],['P1 / 体验验证','原生缩放、辅助技术、多浏览器和真实师生试用','计划已准备，未虚构参与者反馈'],['P2 / 能力扩展','OCR、多Agent自治、共享队列、外部代码安全沙箱','另行设计风险边界，不仓促塞入当前版本']],[83,227,189])
text('当前成果证明：工程流程能够运行，关键数据归属与版本关系可以检查，模型建议和人工结果保持区分。仍不能证明真实模型效果提升、课堂教学成效或全部未展示比赛要求已经满足。')
text('完整源码、迁移、测试与阶段进度是本稿的复核入口。新版本源码包采用独立名称，不覆盖旧包或原项目。截止前停止大型修改，保留可运行、可恢复的状态。','small')

page(26,'来源与原创实现说明','公开来源核对截至2026年11月1日；链接可点击查看原始页面')
source('河南轻工职业学院人工智能学院 · 2026-06-12','https://rgznxy.havcli.edu.cn/info/1714/1724.htm','第八届（2025-2026）AI WEB赛道C组；《数智康护AI健康管理系统》省一、国三。可证实获奖阶段，不能称为国赛一等奖。')
source('广东工商职业技术大学计算机学院 · 2026-06-30','https://jsjx.gdbtu.edu.cn/contents/514/55081.html','第八届AI WEB作品获国赛二等奖，文章未明确组别。同文其他赛道的一等奖不移用于AI WEB。')
source('Triple-Y作者项目说明与许可','https://github.com/sssweetis/chuanzhi-cup-ai-web_Triple-Y','README自述第九届参赛，MIT许可；获奖与组别未证实。只了解按场景组织流程的通用思路，本轮未复制代码、文案或视觉资源。')
source('Little_World_Explorer作者项目说明','https://github.com/NingQi-GUN/Little_World_Explorer','届次、组别、获奖与许可资料不足；不按获奖案例引用，不复制资源。')
source('DeepSeek官方聊天接口文档','https://api-docs.deepseek.com/api/create-chat-completion/','用于核对响应结束原因和实际usage字段；没有用聊天接口充当Embedding，没有据此宣称完成真实模型评测。')
source('既有星环参考：SaturnWebGL','https://github.com/adelmassimo/SaturnWebGL','MIT声明与Three.js声明保存在前端第三方许可文件；星环是装饰组件，不列为原创AI算法。')
text('原创实现证据：需求条目标识、版本/修订校验、人工任务-用例配对、来源快照、有界运行与交付重核均由本项目实现。源码、增量迁移和回归测试可相互核对。截图原要求优先于这些参考资料。','small')

def footer(c,doc):
 c.saveState();c.setStrokeColor(RULE);c.setLineWidth(.5);c.line(48,48,547,48)
 c.setFont('GX',8);c.setFillColor(MUTED);c.drawString(48,33,'工序智伴  /  技术评审稿 v3  /  2026-11-01');c.drawRightString(547,33,f'{doc.page:02d}')
 if doc.page>1:
  c.setFont('GX',8);c.setFillColor(PURPLE);c.drawString(48,807,'GONGXU  /  AI SOFTWARE ENGINEERING WORKSPACE')
 c.restoreState()
doc=SimpleDocTemplate(str(DEST),pagesize=(595.28,841.89),rightMargin=48,leftMargin=48,topMargin=57,bottomMargin=66,title='工序智伴-AI原生软件工程实训智能平台 技术评审稿 v3',author='工序智伴项目',subject='工程实现、证据与竞赛要求核对；真实模型效果待验证')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(str(DEST));count=len(reader.pages)
if count>30:raise RuntimeError(f'Exceeded 30-page contest limit: {count}')
if count!=len(chapters):raise RuntimeError(f'Unexpected overflow pages: expected {len(chapters)}, got {count}')
manifest={'artifact':DEST.name,'pages':count,'chapters':[{'number':n,'title':title} for n,title in chapters],'scope':'technical_review_draft_not_official_acceptance','screenshots':'synthetic_local_account_real_db_model_fixture','visualReview':'pending_render_review'}
(OUT/'technical-pdf-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Created {DEST.name}: {count} pages, {DEST.stat().st_size} bytes; visual review still required.')
