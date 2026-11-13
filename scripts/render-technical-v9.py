"""Build the v9 technical candidate from preserved v7 evidence, without config or network access.

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
evidence=json.loads((ROOT/'docs/verification/review-v7.json').read_text(encoding='utf-8'))
assert evidence['realModels']['newV7Calls']==13 and evidence['realModels']['historicalV4Calls']==12
parser=argparse.ArgumentParser(description='Render the evidence-scoped v9 technical PDF, no network or video generation.')
parser.add_argument('--font',default='C:/Windows/Fonts/msyh.ttc',help='Installed, appropriately licensed CJK TTF/TTC; do not copy proprietary font files into source packages.')
args=parser.parse_args()
pdfmetrics.registerFont(TTFont('GX',args.font))
OUT=ROOT/'output/pdf';OUT.mkdir(parents=True,exist_ok=True)
DEST=OUT/('gongxu-zhiban-technical-v9-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.pdf')
if DEST.exists():raise RuntimeError('Refuse to overwrite a prior document')
INK=colors.HexColor('#241A34');MUTED=colors.HexColor('#64596F');PURPLE=colors.HexColor('#7040AA');RULE=colors.HexColor('#DAD0E7');TEAL=colors.HexColor('#146A6E')
styles={
 'body':ParagraphStyle('body',fontName='GX',fontSize=11.2,leading=18.5,textColor=INK,spaceAfter=11,wordWrap='CJK'),
 'small':ParagraphStyle('small',fontName='GX',fontSize=9.3,leading=15,textColor=MUTED,spaceAfter=9,wordWrap='CJK'),
 'title':ParagraphStyle('title',fontName='GX',fontSize=24,leading=33,textColor=INK,spaceAfter=15,wordWrap='CJK'),
 'sub':ParagraphStyle('sub',fontName='GX',fontSize=12,leading=20,textColor=PURPLE,spaceAfter=18,wordWrap='CJK'),
 'heading':ParagraphStyle('heading',fontName='GX',fontSize=13,leading=20,textColor=TEAL,spaceBefore=9,spaceAfter=9,wordWrap='CJK'),
 'cell':ParagraphStyle('cell',fontName='GX',fontSize=10,leading=16,textColor=INK,wordWrap='CJK'),
 'thead':ParagraphStyle('thead',fontName='GX',fontSize=10,leading=16,textColor=colors.white,wordWrap='CJK'),
}
story=[];chapters=[]
def p(s,kind='body'):return Paragraph(escape(str(s)).replace('\n','<br/>'),styles[kind])
def text(s,kind='body'):story.append(p(s,kind))
def heading(s):text(s,'heading')
def page(title,subtitle):
 if story:story.append(PageBreak())
 chapters.append(title);text(f'{len(chapters):02d}  /  作品说明 / 软件工程实训','small');text(title,'title');text(subtitle,'sub')
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


team_file=ROOT/'.runtime/team-v7.json'
team=json.loads(team_file.read_text(encoding='utf-8')) if team_file.exists() else {'school':'学校待填写','team':'团队待填写','teacher':'指导教师待填写','members':[],'group':'报名组别待核验','edition':'届次待核验'}
def shot(name,limit=300):
 path=ROOT/'docs/screenshots/review-v7'/f'{name}.png'
 w,h=RasterImage.open(path).size; scale=min(499/w,limit/h)
 story.extend([Image(str(path),width=w*scale,height=h*scale,hAlign='LEFT'),Spacer(1,9)])

def point(title,body):heading(title);text(body)

page('工序智伴','AI原生软件工程实训智能平台 · 参赛作品说明')
text('让需求变化，找到需要重做的工程证据。','title')
text('面向软件工程实训的 AI 项目指导与需求、任务、测试证据追踪平台。学生在同一工作区完成项目，教师依据明确提交的固定快照开展反馈与验收。')
diagram([['确认需求与条件','AI候选与人工审核','测试与来源证据'],['需求变化与复核','学生主动提交','教师反馈与验收']])
table(['参赛信息','参赛资料登记'],[['学校 / 团队',team['school']+' / '+team['team']],['参赛学生','、'.join(m['name'] for m in team['members']) or '待填写'],['指导教师',team['teacher']],['届次 / 赛道','第九届传智杯 / AI WEB 网页开发挑战赛'],['组别 / 阶段','均待报名后台核验'],['学历','高职专科（逐人学籍凭证待核）']],[95,404])
text('传智杯 AI WEB 网页开发挑战赛。实际组别、阶段回执、逐人学籍资格及完整提交说明尚未齐备；作品说明不代表已经提交或获得奖项。','small')

page('真实问题与目标用户','学生做了什么，教师凭什么判断，需求变了以后还算不算数')
text('初学者往往能得到一份生成的计划，却说不清它覆盖哪条需求；能展示一次测试通过，却无法确认它仍对应当前规则。教师只看最终文件时，也难以指出具体、可执行的修改方向。')
table(['使用场景','容易出现的脱节','平台给出的下一步'],[['学生改借期','七日改三日后仍沿用旧测试','标出历史来源，建立新版边界用例'],['学生领取任务','教师直接覆盖已领取要求','固定发布版本，明确比较与处理'],['教师反馈作业','看到草稿或其他人的私有资料','仅评阅学生主动共享的固定快照'],['AI生成内容','结构漂亮但条件或依据缺失','保留原文、未决项和人工审核']],[110,180,209])
point('面向的使用者','学生需要逐步实践和保留失败；教师需要核对提交依据并反馈；管理员维护角色与额度，不能因管理身份读取私人正文。')
text('贯穿案例为原创的校园物品借用设计实训。七日、三日和设备身份都是合成约定，不是学校制度；没有声称完成真实课堂推广或证明教学成绩提升。')

page('方案与核心价值','一条可追踪的工程链，连接学生实践和教师判断')
diagram([['需求原文 / 版本','稳定条目 / 位置','候选任务 / 依据'],['测试定义 / 修订','执行记录 / 来源','固定提交 / 反馈']])
point('工程价值','任务、用例和文档保存来源。需求换版后不继承旧版通过结果；修改测试定义会要求重新执行；文档在任务、测试或关联依据变化后提示复核。')
point('教学价值','学生明确提交，教师明确反馈与验收。教师可接受有限阶段成果，但必须留下例外理由，系统仍保留未执行、阻塞与失败。')
point('AI的作用','大模型辅助分析、规划、审查、测试设计和文档起草；RAG提供可展开的专业原文。输出是候选材料，模型不拥有确认需求、发布点评或登记通过的权限。')
text('本项目的价值需通过可复核流程与实际使用继续验证；不把任务数量、页面数量或动画称为学习效果。')

page('需求范围与产品结构','复用同一个登录入口、项目空间与审核机制')
table(['功能','实际行为','约束'],[['需求导师','分析需求并保存草稿，人工确认版本','真实模型只由服务端访问'],['Agent规划','检索、生成、校验、人工采纳、任务保存','结构校验不等于完整正确'],['知识库','PDF/文本解析、分块、向量检索与原文','个人与公共范围明确'],['审查 / 测试','语法检查与AI建议分开；生成用例和人工执行记录','不执行任意学生代码'],['项目文档','生成、编辑、修订、导出和来源变化提示','导出不等于提交或发布'],['教学工作台','任务版本、领取、提交、退回、重交、验收','服务器核验身份及班级'],['成长与交付','根据实际任务/证据展示进度与缺口','不虚构能力评分']],[90,235,174])
text('电脑浏览器为当前优化重点，保留既有兼容布局。已取得官网评分含响应式适配；截图列PC和移动Web作为形态示例，未见必须另开发手机产品的条款。当前仅有桌面专项验证，保留原兼容能力。')

page('系统架构与技术选择','前端交互、服务端编排、关系数据与向量来源分层')
architecture()
table(['技术','选择理由'],[['React + TypeScript + Vite','组件、类型与明确请求状态复用现有工作区'],['Node.js + Fastify','输入校验与业务模块清楚，AI凭据仅留服务端'],['PostgreSQL + pgvector','任务版本、权限、提交与检索数据可共同追溯'],['本地Embedding / 可替换聊天API','聊天与向量接口分离，本地检索控制额外成本']],[175,324])
text('数据库、API、网页和本地向量各自检查就绪。没有把聊天API当Embedding接口；未配置时显示真实不可用状态。模型与工具错误保留可恢复信息，不能用假进度掩盖失败。')

page('Agent与人机协同','每次工具调用有记录，关键判断有明确的人工入口')
diagram([['读取已确认需求','检索专业资料','生成候选计划'],['校验结构与缺项','人工核对及采纳','事务创建待办任务']])
point('真实执行与记录','Agent记录任务状态、工具名称、输入摘要、执行结果和错误。模型只提出候选任务，服务端校验引用标识、依赖与当前需求身份；任务创建在人工确认后完成。')
point('审核的必要性','一个任务可以合理覆盖小需求；没有引用也可能仅依赖需求原文。平台提示缺项、验收方法与依据不足，要求人核对，而不是用固定任务数量判定好坏。')
point('失败与恢复','请求、保存与取消显示实际状态。迟到响应不得覆盖当前项目，旧修订写入返回冲突；不确定的模型请求暂停，避免自动重试造成重复费用。')
text('多阶段编排是工程实现；未宣称多名独立模型已经形成可验证的智能协作提升。官网评分将多模态和MCP或Function Calling单列；当前没有这些能力的完整实现证据，应用内部工具日志不能冒称原生工具调用协议。')

page('RAG与可核对来源','来源存在只是起点，还要判断它支持哪一句结论')
diagram([['上传 / 公共资料','解析与无损分块','本地向量索引'],['授权范围检索','模型结合原文','引用展开与核对']])
text('个人资料仅本人可见；51篇公共教学资料在登录后共用一份索引。引用包含名称、范围及实际片段。资料不足时提示缺口，候选召回片段不冒充答案的支持证据。')
shot('public-original-source',155)
text('实际页面：公开教学案例的存储原文。截图来自与主库公开内容哈希一致的隔离副本；不含私人作业。原始截图和内容哈希随证据索引保留。','small')
text('原文关键句（GX-CASE-01，版本1.0.0）：“旧 v1 的第八日拒绝截图仅保留为历史，不算 v2 的验证。”这是本项目教学示例中的版本约束，不是学校规章。')
text('分块、模型标识和索引兼容性一起核对；容量受限时排队、有界等待和取消。召回命中并不能证明回答正确，引用支持仍需逐句审核。')

page('身份、权限与数据边界','角色视图不是权限；每次服务器请求仍需核对归属')
table(['对象 / 操作','学生','教师','管理员'],[['私人项目 / 草稿','仅本人','无隐含访问','无隐含访问'],['任务草稿 / 发布','不可修改','本人授权班级','需另有教师与班级归属'],['已提交快照','仅本人','本班已提交内容','无隐含评阅权'],['教师反馈','仅已发布','起草、核对后发布','不可代教师发布'],['公共教学资料','登录只读','登录只读','授权维护'],['角色 / 额度 / 日志','不可修改','不可修改','获授权后管理']],[125,115,130,129])
text('教师撤权、账号停用和退出班级后，旧会话再次访问也被拒绝。退出不会删除个人项目和历史。管理员可管理必要元信息，不能因此遍历学生正文。')
text('AI点评先检查学生对外发快照的许可，再由教师确认实际调用。保存响应仍为教师草稿；发布必须再次核对角色、归属与修订。')

page('数据设计与版本一致性','需求、任务书、测试定义和执行结果使用各自的版本语义')
table(['数据实体','关键关系','并发 / 隐私约束'],[['需求与条目','项目、版本、原文位置、稳定ID','已确认原文固定；换版重新核对'],['任务书与发布版本','班级、修订、父版本、适用范围','草稿PATCH；发布版不可覆盖'],['领取与提交','学生、私有项目、任务版本、固定快照','只提交本人最新确认来源'],['测试与执行历史','需求版本、定义修订、独立执行修订','旧执行修订409；定义变化重置结果'],['教学决定与变更处理','提交、检查项、例外理由、处理记录','不代替通过，不改旧提交'],['公共知识与向量','公开范围、内容哈希、版本、模型','按范围检索，不复制个人资料']],[125,180,194])
text('001—025采用增量迁移。旧任务成为v1，旧领取固定v1；不重写学生项目或已有提交。正式本地库升级前后核对项目、需求、测试、文档、提交与角色的指纹一致。')

page('长需求生产规划','保留原文、持久作业与人工合并；真实质量仍有已记录的失败')
diagram([['原文 / 范围 / 哈希','可编辑拆分与审核','逐段持久生成'],['任务与条件候选','合并检查与人工修订','当前版本事务采纳']])
text('支持原文位置、稳定条件标识、边界调整及跨段依赖。修改方案使审核失效；作业保存每段状态、提示词、模型配置、原始输出与用量。有界队列、取消及断点恢复，不重复采纳或自动重试未知请求。')
point('真实评测结果','49,781 UTF-16单位的多章节合成需求拆为13段。v7记录实际调用9段：8段通过结构校验，第9段的任务与片段条件关联不一致，被暂停；后4段未调用，末尾条件尚未得到完整生成验证。')
point('安全限制保留','原始回答未修改，任务未自动采纳。错误已增加明确定位提示；修正或再次请求由人决定。前8段结构通过仍不等于语义完整。测试、文档和代码审查尚未接通完整长需求分段，不宣称全模块支持。')

page('代码审查、测试与文档','把“建议”“人工登记”“实际执行”分开呈现')
table(['能力','输出与来源','不能声称'],[['代码审查','确定性语法检查与模型建议分栏','推测就是已发现漏洞'],['用例设计','正常、边界、异常步骤及需求来源','生成等于测试已执行'],['执行登记','当前定义与执行修订、观察说明','模型替身是学生程序实际运行'],['文档起草','需求/任务/测试/关系的来源快照','同一需求版本永远有效'],['导出与交付','明确缺口和需复核事项','生成或导出就是官网已提交']],[105,210,184])
text('校园案例界面验收专门保留“未实现借用服务、未执行学生代码”的说明。教师接受设计阶段成果时留下例外理由，未执行和阻塞状态仍在。')
text('文档编辑支持未保存保护、修订冲突比较与原始版本保留。当前单次需求长度限制仍为20,000字符；超过完整上下文边界明确阻止，不能静默截尾或要求删除证据绕过。')

page('教师任务编辑与发布','首次保存创建，以后修改同一草稿；发布改变的是版本')
diagram([['创建草稿 / 幂等键','编辑同条 / 修订校验','教师确认发布'],['创建新版草稿','说明变更与适用范围','学生比较并明确处理']])
point('草稿继续编辑','目录直接打开已有任务。双窗口旧修订返回409，输入保留；读取服务器版本进行比较，再明确合并。首次请求结果未知时使用原请求键核对，避免重复创建。')
point('已领取与已提交','新领取使用最新发布版；旧领取保持固定要求。可选择只对新领取适用，或通知已有学生。学生采纳或保留都需说明；已提交需先退回，历史提交和评分依据不被静默覆盖。')
point('教师看到的进度','未领取、已领取未提交、待评、退回、已验收来自有效班级成员的状态记录。统计不读取未提交私人正文。')

page('完整案例：七日改成三日','教师任务变更与学生工程证据更新是两次明确操作')
text('原任务规定借用最多七日、禁止申请人自批。学生领取后确认需求，审核候选计划，生成测试设计并保留未执行说明。教师发布三日版本时说明变化与适用范围。')
shot('02-assignment-change',225)
text('实际界面：学生看到所领v1与新v2，比较后选择。采纳只改变任务适用版本，不自动重写私人需求、用例或文档。')
table(['步骤','操作','可观察结果'],[['1','学生手动保存三日需求并确认','新需求版本建立'],['2','打开旧文档与测试来源','历史或来源变化提示'],['3','修订用例并登记实际限制','不继承旧版通过，不假装执行'],['4','主动提交固定快照','教师开始看本次明确共享内容']],[40,205,254])
text('下页连续画面来自同一次隔离界面验收。账号与业务为合成数据，生成采用本地协议替身；不把它们当作真实师生反馈或现场模型效果。','small')

page('从依据失效到反馈复核','同一校园借用案例的连续画面；编号对应真实操作顺序')
text('01 需求改为三日，旧文档依据提示历史 / 需复核。','heading');shot('04-stale-document',52)
text('02 教师核对提交后发布反馈并退回，指出具体输入缺口。','heading');shot('05-teacher-feedback',62)
text('03 学生补充申请人自批的步骤，再次提交；执行仍未完成。','heading');shot('06-student-revision',212)
text('04 教师仅接受设计阶段，记录例外范围，测试状态不改变。','heading');shot('07-reviewed-acceptance',82)
text('这些是实际网页局部截图，没有改写截图内容。完整第一次与第二次提交保留在隔离数据中；接口准备仅用于合成注册和角色，业务流程由网页完成。','small')

page('公共课程与引用证据','51篇资料、53个向量片段；工程核对不等于独立教师审定')
shot('public-catalogue',310)
table(['核对项','实际依据'],[['数量与范围','八类各6篇及3个原创案例；登录后只读共用'],['一致性','逐篇内容哈希与主库公开课程相同；无私人资料'],['索引与原文','53片段有本地向量；页面可读来源与版本'],['效果边界','26题召回检查不等于答案准确率；独立教师仍待审核']],[100,399])
text('示例原文强调：旧v1的第八日拒绝证据保留为历史，不算v2验证；引用来源只支持其中具体技术概念。真实目录没有混入额外权限夹具，截图中每项索引状态由服务端返回。','small')

page('真实AI验证与人工审核','历史12次与v7的13次分别保留；本候选未新增收费调用')
table(['样本','真实结果','边界'],[['历史12次回答','保存原始合成输入、引用、回答和匿名审核表','历史提示词回放不是完整旧系统'],['v7长需求9次调用','8段结构接受，9段关联不一致，后4段未调用','没有完成整份长需求生成验证'],['v7教师点评4次调用','草稿已保存；未发布、未改测试或权限','缺少独立人工逐项判定'],['费用与限制','v7的13次调用，无重试；峰值估算约$0.0494','不是账单确认；预算上限$0.50']],[110,220,169])
text('审核分别记录遗漏、引用支持、错误回答、正确与错误拒答，以及实际修改字符数和耗时。空白表保留待审，AI初审独立标识，不宣称教师盲评或提升百分比。')
text('已发现的初审问题包括：点评可能提出超出设计阶段的实现要求；一份案例的“步骤已具体化”预设与输入不完全相符，需先复核判定标准。没有改原回答或删除普通问答更好的历史样本。')
text('官方价格来源：api-docs.deepseek.com/quick_start/pricing/。使用deepseek-flash别名，非不可变版本锁定；每例仅一次，不能推断稳定质量或全量账号隔离。','small')

page('分层测试与实际证据','当前离线复核与历史真实环境证据分别报告')
counts=evidence['offlineCounts']
table(['层级 / 命令','结果','范围'],[['pnpm verify','15步骤通过',f"API{counts['api-unit']}、向量{counts['embedding-unit']}、根JS{counts['root-script-unit']}、Python12分别通过"],['v7数据库验证','19步骤通过','真实隔离PostgreSQL，空库25迁移及重复执行'],['v7浏览器验证','7步骤通过','受控浏览器、完整教学UI、生产构建恢复'],['v7可访问性验证','通过','桌面自动规则；不能替代全部人工审核'],['v7长需求故障回归','16组＋实际浏览器流程通过','原始错误分类先失败后修复，模型是替身'],['真实模型 / 人工','v7为13次；本候选新增0；独立人审0','工程检查与语义判定不合并成总通过率']],[158,125,216])
text('当前候选重新执行默认离线验证；数据库、浏览器、可访问性和长需求故障记录来自2026-11-02的v7工程验证。业务源码未改，未重复声称新增真实环境联调。原报告与哈希保留。','small')
text('关键回归覆盖双窗口保存、发布版本、已领取和已提交保护、越权与撤权、退出班级、失败输入保留、旧执行修订及需求变更。保留首次失败记录；没有删测试、弱化断言或隐藏长需求真实失败。')
text('v7曾在空依赖存储安装355包、运行空库25迁移与手工流程；v8解压副本复用本机依赖存储并通过离线验证。当前候选另行记录实际解压检查，未作新机器安装或新的空库验收。')

page('电脑交互、性能与原创边界','让用户知道现在缺什么、下一步做什么')
point('布局与信息层级','复用统一深色工作区、表格和编辑器。任务目录提供继续编辑入口；变更比较和历史按需展开；教师检查项及例外范围明确呈现。避免新增无关模块或装饰信息。')
point('真实状态与键盘','保存、排队、取消、失败与冲突来自实际请求。焦点、键盘关闭、未保存保护和减少动态效果沿用既有机制。常规界面过渡动画约180ms，这不是系统响应性能。')
point('评分依据与能力边界','当前官网AI WEB评分：AI深度35%、创新25%，前端工程、实用性、体验、社会价值与商业潜力各10%。多模态5%、MCP或Function Calling4%是评分项，当前不能宣称已实现。逐字流式输出没有接通，不把真实状态显示等同该能力。第九届和赛道已明确；组别和阶段仍须与报名记录对应。')
text('任务版本、提交快照、例外验收和追踪业务通过本项目设计与AI辅助实现。项目使用第三方组件、预览代码及模型，具体来源、许可证与用途另列；不把外部模型或视觉组件称为自研算法。许可不等于比赛原创达标。当前官网允许AI辅助，但要求选手解释全部代码；学生理解和实际贡献仍缺独立记录，大量AI参与的披露方式待确认。')

text('规则来源：boxuegu.com/matchTrack/detail/?id=10037；2026-11-02核对，页面未显示发布日期。来源与冲突表见COMPLIANCE-SOURCES-V9。','small')

page('部署、提交与比赛核验','必交项、可选加分项及信息不足分开')
table(['已知条款','当前状态','责任 / 下一步'],[['原创、AI核心Web','部分符合','工程有证据；AI参与与代码解释义务仍待复核'],['C组资格、1—3同校学生、≤2教师','缺少报名与资格证据','团队核对学籍、实际组别、阶段和报名回执'],['GitHub/Gitee与真实Git历史','部分符合：本地历史存在','本地无remote，评审访问待核；ZIP不能代替'],['README、模板、依赖与运行','部分符合：真实团队字段另存','团队按脱敏副本独立复现'],['PDF≤30页及必要章节','页数章节核对；材料整体待定稿','保留未验证内容，不宣称全部达标'],['5—8分钟1080p MP4普通话','缺少本版正式成片证据','由参赛者制作、检查成片'],['公网在线演示','截图列可选；未部署','另行明确授权与可用性检查'],['官网统一提交','未操作；无平台回执','团队操作并保留回执']],[158,170,171])
text('官网细则已取得，但11月18日作品与指导截止、2027年1月底反馈后最终提交的表述互有冲突。官网明确提交后不可修改，特殊需联系组委会；冻结对象、最终时刻、命名与大小待确认。当前仅完成本地核查，尚不能确认全部提交条件，未实际提交。','small')

page('总结、分工与下一步','工程闭环已经可运行，人的理解与审核仍不可省略')
text('工序智伴将“需求变化后，哪些任务和证据还有效”作为中心问题。学生保留自己的实践过程，教师在固定版本上反馈，AI提供候选与原文参考，平台保留失败和判断边界。')
table(['未来责任分配','应亲自完成的工作'],[['产品统筹 / 演示','整理需求与验收清单；体验教学全流程；汇总问题；核对稿件并自行制作视频'],['前端体验 / 交互测试','检查三角色界面、切换、键盘、缩放、错误和未保存保护；复现并参与修复'],['后端验证 / 资料审核','验证接口、数据库、权限、版本、快照及恢复；核对知识和回答；整理证据']],[160,339])
text('以上按现有名单顺序暂关联三位成员，姓名对应待团队核对；不推定聊天参与者身份。这是待执行责任，不代表已完成贡献。AI生成、人工修改、测试和审核分开登记时间、产物及证据；指导教师意见与师生试用尚无实际记录。')
point('下一步优先事项','先完成教师独立审核与团队复现，处理长需求第9段并核对未生成的末尾条件；再核实报名材料、制作正式视频和准备评审仓库访问。官网允许AI辅助，但要求选手能解释所有代码；应先记录实际走读和复现。正式材料须与报名记录一致，不能把未来责任当既往贡献。')
text('官网将后端限定为AI能力接入层；本项目还承担教学权限、版本与证据持久化。这一技术边界需组委会书面确认，不能只因前端可操作就判为符合。','small')
text('作品质量以功能、证据和可复核限制说明为依据。技术材料与演讲稿不保证获奖，也不替代组委会确认。','sub')

def footer(c,doc):
 c.saveState();c.setStrokeColor(RULE);c.line(48,48,547,48);c.setFont('GX',8);c.setFillColor(MUTED);c.drawString(48,33,'工序智伴 / 参赛作品说明 v9 / '+datetime.now().strftime('%Y-%m-%d'));c.drawRightString(547,33,f'{doc.page:02d}');c.restoreState()
doc=SimpleDocTemplate(str(DEST),pagesize=(595.28,841.89),rightMargin=48,leftMargin=48,topMargin=48,bottomMargin=62,title='工序智伴 - 参赛作品说明',author='工序智伴项目',subject='需求变化、教学反馈与工程证据追踪')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
count=len(PdfReader(str(DEST)).pages)
if count!=len(chapters) or count>30:raise RuntimeError(f'Layout needs correction: {count} pages for {len(chapters)} chapters; {DEST}')
manifest={'edition':'v9','pdf':str(DEST.relative_to(ROOT)).replace('\\','/'),'pages':count,'chapters':chapters,'bytes':DEST.stat().st_size,'sha256':hashlib.sha256(DEST.read_bytes()).hexdigest(),'visualReview':'pending_render_and_inspection','evidenceIndex':'docs/verification/review-v7.json','realModelCallsThisRound':0,'previousV7RealModelCalls':13,'businessBaselineCommit':'2defd8b1e7c8a4f5225915a4599f0767173475a9','complianceChecklist':'docs/archive/COMPLIANCE-CHECKLIST-V9.md','historicalRealModelCalls':12,'independentHumanReviews':0,'teamInfo':'registered_fields_eligibility_unverified_future_responsibilities_not_past_contributions','submitted':False}
(DEST.parent/(DEST.stem+'-manifest.json')).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pdf':str(DEST),'pages':count,'bytes':DEST.stat().st_size,'visualReview':'pending'},ensure_ascii=False))
