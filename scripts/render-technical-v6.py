"""Build the v6 technical review from evidence, without config or network access.

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
evidence=json.loads((ROOT/'docs/verification/review-v6.json').read_text(encoding='utf-8'))
assert evidence['realModels']['newCalls']==0 and evidence['realModels']['v4HistoricalCalls']==12
parser=argparse.ArgumentParser(description='Render the evidence-scoped v6 technical PDF, no network or video generation.')
parser.add_argument('--font',default='C:/Windows/Fonts/msyh.ttc',help='Installed, appropriately licensed CJK TTF/TTC; do not copy proprietary font files into source packages.')
args=parser.parse_args()
pdfmetrics.registerFont(TTFont('GX',args.font))
OUT=ROOT/'output/pdf';OUT.mkdir(parents=True,exist_ok=True)
DEST=OUT/('gongxu-zhiban-technical-v6-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.pdf')
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


page('工序智伴','AI原生软件工程实训智能平台 · 技术评审稿 v6')
story.append(Spacer(1,24));text('需求变了，工程证据也要跟得上。','title')
text('面向软件工程实训的AI项目指导与需求、任务、测试证据追踪平台。同一站点内组织学生、教师、管理员的授权工作空间。')
diagram([['教师发布任务\n学生领取项目','确认需求\n审核AI候选','建立测试\n登记真实观察'],['需求变化\n复核失效关系','主动提交快照\n教师反馈与退回','再次修订\n人工验收交付']])
text('传智杯 AI WEB 网页开发挑战赛 · 拟报C组\n2026年11月1日 · 本地研发与验证成果，尚未提交','sub')
text('团队姓名、学校、学籍、指导教师和报名组别待参赛者真实填写。按七张截图清晰可见条款验收；未获得完整评分权重和国赛细则，不保证奖项。','small')

page('项目概述与真实痛点','核心问题：需求变化使工程记录与教学反馈脱节')
text('学生能生成代码或文档，却难以证明任务覆盖了什么、测试检验了哪个版本、报告仍否引用当前依据。教师若只接收最终文件，也难以指出可执行的下一步。')
table(['场景','常见缺口','本项目处理'],[['借用七日改三日','旧测试通过被误用','按确认需求和用例修订隔离证据'],['申请人禁止自批','末尾条件被忽略','保留全文位置、条件与遗漏检查'],['教师查看作业','草稿与私有资料被过度分享','学生明确共享固定快照，不开放原项目'],['AI输出看似完整','结构合法被误认为事实正确','模型建议、人工确认、执行记录分层']],[120,170,209])
text('校园物品借用是贯穿演示的原创合成案例；规则不是学校制度。图书借阅和实训任务管理用于补充教学边界。没有声称完成真实学校推广或提高教学成绩。')

page('需求分析与能力边界','先完成可验证的教学与工程闭环')
table(['参与者','主要需求','验收边界'],[['学生','领取任务、保持草稿私有、明确提交、修订重交','只访问本人项目和本人提交'],['教师','发布本班任务、看提交证据、反馈和决定','当前授权班级；不得看未提交草稿或自我验收'],['管理员','账号、角色、调用额度、操作日志','无私人项目或作业正文的隐含读取权'],['全体登录者','公共原创教材与原文检索','公共共用一份；匿名不可读；个人资料不变']],[70,210,219])
text('已实现：同站点授权身份、教学提交/返修、公共知识资料、证据追踪及长需求规划生产链路。尚未完成：独立教师质量审核、真实课堂试用、多实例容量评测、其他模块长上下文分段生成。')
text('复用现有React、TypeScript、Vite、Fastify、PostgreSQL/pgvector与本地Embedding，未新增应用运行时依赖或另建一套产品。')

page('系统架构与AI选型','同一账号入口；聊天与向量服务独立可替换')
architecture()
text('React工作区提供需求编辑、计划与来源审阅、测试登记和角色化教学界面。Fastify在后端核对登录会话、角色、班级及资料归属。PostgreSQL保存版本和教学快照；pgvector只检索本人私有与明确公共范围。')
text('聊天采用服务端可配置API，已有DeepSeek真实响应；API密钥不进入前端。Embedding使用本地BGE中文模型及独立适配器，不将DeepSeek聊天接口当向量接口。引用和输出是待核对材料，不执行其中指令。')
text('技术选型服务于工程稳定与有限成本，不宣称自行训练模型。MCP、多模态是截图背景/推荐，不是可见的全部必做项，本轮不为术语扩展范围。')

page('角色权限与数据范围','权限来自后端授权，不来自菜单选择')
table(['资源 / 操作','学生','教师','管理员'],[['本人个人项目与私人知识','本人读写','本人读写','本人读写'],['其他人的私有项目或草稿','禁止','禁止','禁止'],['本班已提交固定快照','只看本人','本人负责且角色仍有效','不隐含授权'],['任务发布 / 反馈 / 验收','禁止','本班；确认后发布','不隐含教师能力'],['公共教材','只读','只读','追加版本、索引'],['角色 / 额度 / 审计','禁止','禁止','授权管理，记录理由']],[150,110,120,119])
text('注册默认学生；教师/管理员由当前管理员明确授权。本轮只在合成隔离库授予测试角色，主库没有提权。学生退出班级或教师撤权后，新请求重新检查；不因保留历史快照而放宽访问。')
text('学生额外选择是否允许教师把本次提交发送至外部模型；教师还需确认本次调用。没有学生同意就只能人工反馈。')

page('教学闭环与人工审核','共享、发布和验收都是可解释的人工动作')
diagram([['任务草稿\n教师明确发布','学生领取\n新私有项目','提交预览\n版本与缺口'],['固定快照\n学生明确共享','教师草稿\n修改后确认发布','退回或验收\n保留决定历史']])
text('提交保存需求、任务、测试、文档和追踪关联的固定版本，不共享私人知识、代码草稿或其他项目。退回后学生修改形成新提交；旧快照不随项目变更。')
text('教师可修订人工或AI辅助草稿；AI原输出独立保留。草稿未确认时学生不可见，发布要求修订一致和明确确认。教师决定不会把未执行/失败的测试自动改成通过。')
text('快照集合最多1000项、整体1 MB，最新需求必须已确认；AI点评完整上下文最多18000字符。超限整份拒绝，不截掉证据。')

page('数据库设计与安全迁移','追加结构，不通过清空数据解决兼容问题')
table(['关系','用途','约束'],[['users → teaching_roles / accounts','身份、停用、额度','每次读取实时核对；无自动提权'],['class → members / assignments','班级、成员、任务草稿/发布','教师归属、成员有效性、修订冲突'],['assignment → claims → submissions','领取、不可变提交版本','领取唯一、请求键幂等、来源指纹'],['submission → feedback / decisions','私有草稿、人工发布、退回/验收','发布确认、最新提交、修订一致'],['knowledge_documents → chunks / imports','私有/公共范围、向量、导入恢复','owner与范围约束、版本/哈希唯一'],['ai_call_budget / receipts / audit','调用尝试和最小操作记录','事务预留，不记录密钥']],[170,160,169])
text('023、024仅增表/列和约束，旧知识默认personal。空库001—024、重复迁移、就绪和核心持久化已验证。主库应用前确认无活动生成，应用后原项目、需求、私人资料数量不变。')

page('需求到验证证据的追踪','存在关联，不等于已经完成验证')
diagram([['需求条目\n原文范围 / 版本','开发任务\n验收方法 / 来源','测试定义\n当前修订'],['建议关联\n等待人工审核','执行记录\n人工观察 / 说明','交付依据\n检查来源变化']])
text('条目标识与原文绑定，任务、用例和人工配对记录各有状态。用例定义版本和执行修订分离；两个窗口登记结果，旧执行修订返回409，保存历史不能代替冲突检查。')
text('新版需求不能沿用旧版通过；同版任务、测试或人工关系改变，也会使文档来源待复核。教学提交预览加入相同检查，不把“有一份文档”当作依据有效。教师可逐条展开原文位置、关联修订与实际说明。')
text('这是一套原创工程应用规则，目的是支持学生解释过程。不是自动证明软件正确，也不是新的基础模型算法。')

page('长需求生产流程','全文、拆分、生成、合并和采纳都有可追溯状态')
table(['阶段','已实现','保护'],[['拆分审阅','可编辑边界、原文位置/哈希、稳定原子条件、跨段依赖','检查完整覆盖；变更使审核失效'],['持久作业','归属、需求/方案修订、提示词/模型快照、分段输出/用量/错误','有界队列；取消保留成功段'],['真实输出适配器','候选任务、验收方法、条件、引用、未决问题','不是只输出覆盖ID；不确定请求不自动重发'],['全局合并','遗漏、重复、冲突、依赖、依据提示及人工修订','结构完整不冒充语义完整'],['人工采纳','事务重新核对需求与结果修订，幂等写正式计划','旧版不能覆盖新版；不自动确认测试']],[80,224,195])
text('沿用v5已经实现的生产链路，没有重复重写。49781字符、10章、13段原创业务案例通过协议和数据库/浏览器路径。新的真实模型长规划质量仍待授权与人工评审。')
text('目前只接通规划。测试生成、文档和代码审查的长上下文分段尚未接通；单次20000字符和存储50000字符边界保留，不靠扩大上限或静默截断绕过限制。')

page('并发与失败恢复','不确定结果不是失败后随便再调用一次')
table(['风险','实现','验证层'],[['重复领取 / 提交','唯一约束、请求键、指纹和修订','实际SQL/HTTP并发'],['教师或维护者撤权','短事务授权；模型/索引结束再次核对','延迟本地替身期间撤权'],['模型超时 / 服务重启','保存已完成状态；未知计费不自动重试','长作业故障回归'],['额度竞争','公共模型入口原子预留，长工作器绑定归属','真实HTTP + 本地模型协议替身'],['索引排队 / 取消','有界串行容量、超时、有限退避、状态','真实本地向量及服务故障替身'],['迟到界面响应','请求归属、卸载检查、草稿保护','原有回归保留并复跑']],[113,229,157])
text('月额度按UTC月份统计派发尝试，包含失败和不确定响应，不是费用账单。取消等待不保证撤回已发送请求。课堂多人容量和跨进程大规模负载尚未评测，不宣传已支持任意并发。')

page('公共教学知识建设','共享本轮原创资料，绝不自动公开旧资料')
table(['分类','篇数','教学重点'],[['需求分析 / 项目规划','各6','范围、原子条件、依赖、审核与恢复'],['前端 / 后端与接口','各6','状态、异步归属、协议、幂等与错误'],['数据库 / 测试验收','各6','事务、约束、版本、真实执行证据'],['安全权限 / 项目交付','各6','归属、注入、资料分享、发布与复核'],['原创综合案例','3','校园物品借用、图书借阅、实训任务管理']],[210,60,229])
text('共51篇、53个真实向量片段，已导入本机公共知识库。每篇有场景、知识点、示例、常见错误、验收要点、分类、版本和来源。第二次导入全部跳过已有索引，没有给账号复制多份。')
text('业务规则为原创教学示例，非学校制度或官方标准；经AI辅助写作与官方技术依据检查，独立教师尚未审阅。个人资料/作业/班级内容仍维持原范围；未来班级共享必须显式设计。')

page('RAG与来源核对','向量召回、资料支持和回答正确是三个问题')
diagram([['上传或授权导入\n解析 / 分块 / 存储','本地Embedding\n有界队列 / 索引','登录检索\n本人私有 + 明确公共'],['候选原文\n版本 / 范围标识','回答或资料不足\n引用检查','人工核对\n支持 / 冲突 / 无法判断']])
text('26个验收问题含有答案、无答案、冲突资料和恶意指令案例。25个指定来源的问题均召回至少一篇预期资料；另一个无答案问题不指定目标来源。报告保存实际原文与距离。此数字不是回答准确率，也不是恶意指令防护成功率。')
text('真实本地Embedding已验证；这批问题未新增真实聊天回答。引用ID存在不意味着来源支持结论，缺少资料时应明确缺口。多账号同读、匿名禁止、普通账号不能修改、私人资料不泄露另由SQL/HTTP回归证明。')

page('真实AI评测与独立审核','已有12次真实调用；本轮不为补报告重复收费')
table(['证据','当前状态','限制'],[['v4保存真实响应','12次DeepSeek Flash；输出哈希核对','HTTP成功不等于质量通过'],['匿名审核包','15样本：12回答 + 3策略阻止','原文、引用、原子条件、空白审核表'],['逐维度判断','遗漏、支持、回答/拒答、修改量','独立人审0；不计算提升百分比'],['历史组','历史提示词回放','不是完整旧系统复现'],['v6新增调用','0次','长规划/教师点评质量仍待验证']],[135,190,174])
text('保留普通问答更好的末尾自审批案例和历史截断遗漏，不只挑有利输出。模型没有不可变版本标识，每输入仅一次；固定合成资料不代表实际教学分布。AI初审不是独立教师盲评。')
text('准备真实师生试用：自愿参与、合成任务、独立双人审阅、记录原始分歧和真实修改量。尚未联系参与者、未得到教学效果数据。新增付费验证须重新批准范围。')

page('桌面交互与可访问性','把当前缺口与下一步放到操作前面')
im=Image(str(ROOT/'docs/screenshots/review-v6/teacher-desktop.png'),width=499,height=499*1000/1440);story.append(im);story.append(Spacer(1,10))
text('实际Edge与隔离数据库的合成教师界面。统一原深色设计，班级设置按需展开，待处理数来自记录；固定快照与发布确认减少重复填表。截图不是实际学生作业。','small')
text('常规反馈180ms，尊重减少动态效果；输入有稳定标签，键盘和焦点沿用统一保护。修复200%CSS缩放时表格把按钮挤出视口，保留长表格内部滚动，不开发新的手机界面。')

page('知识库阅读体验','实际来源、公共范围与索引状态明确显示')
story.append(Image(str(ROOT/'docs/screenshots/review-v6/public-knowledge-desktop.png'),width=499,height=499*1000/1440));story.append(Spacer(1,10))
text('隔离浏览器截图：51篇课程加3份权限协议夹具，共54项。该隔离页面未配置真实向量，所以如实显示待索引；主库批准批次为51篇、53块，已完成本地向量索引，详见独立导入证据。','small')
text('公共目录分页并可收起，避免挤走检索/上传操作；点击读取实际片段，显示范围、分类与版本。普通账号只有只读操作，资料来源与本人私人上传区分。')

page('测试与效果证据','分层记录本轮真实命令，不沿用历史通过数')
table(['入口 / 层级','本轮结果','不能证明什么'],[['pnpm verify','15步；API139、向量4、根JS83、Python9分别通过','单元/协议不是生成质量'],['verify --suite=database','19步；空库24迁移、并发、版本、检索','本机隔离数据，不是多人课堂压测'],['verify --suite=browser','6步；原100场景与新增教学/公共目录','受控浏览器，不是用户试用'],['verify --suite=accessibility','25场景，0自动违规规则','自动检查不替代全部人工可访问性审核'],['教学SQL/HTTP/Edge','13组权限/故障；4界面axe检查','合成身份和本地点评替身'],['主库课程 / 历史审核','51篇真实本地索引；12旧响应离线核对','无新增真实聊天或独立人审']],[165,185,149])
text('首次发现反馈修改接口缺失和200%缩放溢出，保留失败后修复；公共发布/索引撤权补事务回归；长规划额度错误分类先红后绿。没有删除测试或弱化断言。报告路径、命令、哈希见docs/verification/review-v6.json。','small')

page('安装、启动与可恢复交付','源码包与独立材料有不同边界')
table(['步骤','要求与实际范围'],[['依赖','pnpm install --frozen-lockfile。独立副本使用新依赖目录和新存储；明确记录是否复用、是否执行安装脚本，不称完整新机器。'],['数据库','PostgreSQL/pgvector，构建API后执行迁移。001—024空库与重复执行检查；现有真实数据不清空。'],['本地启动','pnpm start:local -Database external；API更新安全重启。health/ready与浏览器分别检查，不发收费请求。'],['断点恢复','长作业保留成功段；未知请求不自动重发。课程索引按哈希/模型跳过已完成；教师提交与反馈保留版本。'],['源码ZIP','保留源码、锁文件、迁移、测试、课程源、报告；排除真实.env、凭据、私有数据、依赖、缓存、日志、构建和.git。']],[85,414])
text('旧包保留，新包不覆盖。解压后核对必要文件与清单哈希；脱敏仅修改副本。公开仓库访问、推送、部署及比赛提交仍需单独授权。')

page('比赛截图逐条验收','只使用可见要求，不编造评分权重')
table(['条款','状态','证据或差距'],[['现代Web / AI核心 / 原创','部分满足','真实工程链和第三方声明；语义质量与完整原创规则待核'],['教育/代码辅助推荐方向','已满足并验证：选题对应','软件工程实训，不代表已验证教学成效'],['C组 / 队伍人数','信息不足','高职高专、1—3同校学生、≤2教师需真实材料'],['GitHub/Gitee / README / 环境','部分满足','本地历史/源包/模板有；远程评审权限及团队待补'],['视频5—8分 / 1080p MP4','部分满足','只交7分钟稿与提纲，用户自行制作成片'],['PDF≤30页与必要章节','页数/渲染验证后满足该子项；总体部分满足','团队/完整规则及独立质量证据未齐'],['公网演示（可选加分）','不满足','本地可用不是公网部署'],['官网提交 / 缺失细则','未提交；信息不足','无提交回执；裁切、权重、国赛规则未补']],[155,155,189])
text('截图省赛报名/作品日期2026-11-18，未见具体时分。PC/移动Web为形态示例，可见条款没有强制同时开发两端。MCP与多模态不因推荐背景而自动成为硬性功能。','small')

page('公开参考与原创边界','核实来源范围，只借鉴通用方法')
text('河南轻工职业学院2026-06-12原报道：第八届2025—2026传智杯、AI WEB、C组，《数智康护AI健康管理系统》省一、国三，不能说成国一。')
story.append(Paragraph('<link href="https://rgznxy.havcli.edu.cn/info/1714/1724.htm" color="#7040AA">河南轻工职业学院原报道</link>',styles['body']))
text('湄洲湾职业技术学院2026-06-16展示可确认第八届AI WEB国一等奖条目，但国赛组别和作品实现材料不完整，不作为同组国一技术样板。')
story.append(Paragraph('<link href="https://xxgcx.fjmzw.com/_t13/2026/0616/c722a114178/page.htm" color="#7040AA">湄洲湾职业技术学院展示材料</link>',styles['body']))
text('借鉴围绕具体使用者组织完整流程的通用思路，独立实现教学提交/返修、权限与工程证据。本轮未复制案例代码、文案、素材或特色界面，也不以往届规则替代本届截图。')
text('课程来源逐篇列于knowledge/teaching-v6/sources.mjs。既有前端库/三维资源和BGE模型许可在THIRD-PARTY-LICENSES、vendor NOTICE、Embedding THIRD_PARTY_NOTICES中保留。没有新增运行时第三方依赖，不把第三方模型训练、组件或星球动画算作自研创新。')

page('总结与下一步','本地可用成果与尚需人的判断分开交付')
text('v6把个人项目追踪延伸到最小教学闭环，新增共享边界明确的公共资料，并让教师核对固定版本的任务、测试和文档依据。核心成果是工程规则、权限和可审计的状态流，不是增加装饰页面。')
table(['优先级','待完成事项','所需条件'],[['1','独立审核12份已保存响应和51篇教学资料','真实教师/审核者参与；不需要新模型费用'],['2','指定真实教师/管理员账号并授权','准确账号与明确提权范围；本轮未做'],['3','长需求/点评新真实质量验证、课堂试用','新模型范围与费用授权、参与者同意'],['4','补团队/学籍/组别、正式视频、完整规则','用户真实资料；用户制作视频'],['5','远程评审访问、公开部署与比赛提交','明确外部操作授权与正式入口']],[45,270,184])
text('交付：源码ZIP、技术PDF、中文逐字稿与操作提纲、公共课程清单、真实响应审核包、权限矩阵及验证报告。视频未制作、材料未提交，不把部分满足改写为全部达标。','sub')

def footer(c,doc):
 c.saveState();c.setStrokeColor(RULE);c.line(48,48,547,48);c.setFont('GX',8);c.setFillColor(MUTED);c.drawString(48,33,'工序智伴 / 技术评审稿 v6 / 2026-11-01');c.drawRightString(547,33,f'{doc.page:02d}');c.restoreState()
doc=SimpleDocTemplate(str(DEST),pagesize=(595.28,841.89),rightMargin=48,leftMargin=48,topMargin=57,bottomMargin=66,title='工序智伴 v6 技术评审稿',author='工序智伴项目',subject='教学闭环、权限与证据；真实模型质量及独立人审边界')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
count=len(PdfReader(str(DEST)).pages)
if count!=len(chapters) or count>30:raise RuntimeError(f'Layout needs correction: {count} pages for {len(chapters)} chapters')
manifest={'edition':'v6','pdf':str(DEST.relative_to(ROOT)).replace('\\','/'),'pages':count,'chapters':chapters,'bytes':DEST.stat().st_size,'sha256':hashlib.sha256(DEST.read_bytes()).hexdigest(),'visualReview':'pending_render_and_inspection','evidenceIndex':'docs/verification/review-v6.json','realModelCallsThisRound':0,'historicalRealModelCalls':12,'teamInfo':'pending_user','submitted':False}
(DEST.parent/(DEST.stem+'-manifest.json')).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pdf':str(DEST),'pages':count,'bytes':DEST.stat().st_size,'visualReview':'pending'},ensure_ascii=False))
