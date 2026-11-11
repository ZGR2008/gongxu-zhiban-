// Local, editable defence draft. No cloud session, external assets or user data.
// Use the installed presentation runtime; do not install runtime substitutes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const runtime=argument('runtime'),skill=argument('skill'),python=argument('python');
if(!runtime||!skill||!python)throw Error('Pass verified bundled --runtime=node_modules --skill=presentation-skill --python=executable paths');
process.env.RUNTIME_NODE_MODULES=runtime;
const {Presentation,PresentationFile}=await import(pathToFileURL(path.join(runtime,'@oai/artifact-tool/dist/artifact_tool.mjs')).href);
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const build=path.join(root,'tmp/presentations',stamp),output=path.join(root,'output/presentations');await fs.mkdir(build,{recursive:true});await fs.mkdir(output,{recursive:true});
const font='Microsoft YaHei',presentation=Presentation.create({slideSize:{width:1280,height:720}}),pages=[];
presentation.theme.defaultFont=font;
const color={bg:'#0A0614',white:'#F6F1FF',muted:'#D1C4E9',purple:'#CDB0FA',cyan:'#82E8ED'};
const {commit:sourceCommit}=sourceProvenance(root);
function text(slide,name,value,x,y,w,h,size=28,fill=color.white,bold=false){const shape=slide.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});shape.text=value;shape.text.style={typeface:font,fontSize:size,color:fill,bold};return shape;}
function page(title,notes){const slide=presentation.slides.add();slide.background.fill=color.bg;text(slide,'slide-title',title,64,44,1152,85,44,color.white,true);text(slide,'page-number',String(pages.length+1).padStart(2,'0'),1160,660,60,30,18,color.muted);slide.speakerNotes.text=notes;pages.push({title,notes});return slide;}
async function shot(slide,name,x=64,y=160,w=820,h=448,crop){const blob=new Uint8Array(await fs.readFile(path.join(root,'docs/screenshots/review-v3',name)));slide.images.add({blob,contentType:'image/png',alt:'本项目独立合成账号的实际本地界面，聊天为替身',fit:crop?'cover':'contain',...(crop?{crop}:{}),position:{left:x,top:y,width:w,height:h}});}
function rows(slide,items,x=64,y=170,w=1152,gap=116){items.forEach(([title,body],i)=>{text(slide,`topic-${i}`,title,x,y+i*gap,w,44,30,color.purple,true);text(slide,`detail-${i}`,body,x,y+49+i*gap,w,65,25,color.muted);});}
function note(slide,value){text(slide,'evidence-scope',value,64,617,1090,45,18,color.muted);}
function node(slide,name,title,detail,x,y,w,h=130){slide.shapes.add({geometry:'roundRect',name,position:{left:x,top:y,width:w,height:h},fill:'#171020',line:{fill:'#5D3E77',width:1.5}});text(slide,`${name}-title`,title,x+18,y+18,w-36,46,28,color.white,true);text(slide,`${name}-detail`,detail,x+18,y+70,w-36,h-78,21,color.muted);}
function arrow(slide,name,x,y,w=28,h=18,direction='rightArrow'){slide.shapes.add({geometry:direction,name,position:{left:x,top:y,width:w,height:h},fill:color.cyan,line:{fill:'none',width:0}});}
function table(slide,values,widths){const table=slide.tables.add({rows:values.length,columns:values[0].length,left:64,top:185,width:1152,height:330,columnWidths:widths,values});table.borders.assign({style:'solid',fill:'#4B365F',width:1});for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){const cell=table.getCell(r,c);cell.fill=r===0?'#332042':'#151020';cell.text.style={typeface:font,fontSize:r===0?26:24,color:color.white,bold:r===0};}return table;}

let s=page('工序智伴','建议用时25秒。各位老师好，我展示的是面向高职软件技术实训的工序智伴。项目把需求、任务和测试证据放在同一版本关系下，让学生能核对AI建议的来源与后续验证。以下工程画面使用独立合成账号，真实数据库和本地向量服务，聊天使用明确标识的替身。真实模型效果及教学效果仍待专门评测。\n来源：README、TECHNICAL-MATERIAL、CONTEST-ACCEPTANCE-2026-11。');
text(s,'cover-name','AI 原生软件工程实训智能平台',64,211,1110,100,50,color.white,true);text(s,'cover-context','需求、任务与测试证据的版本化协作',64,335,1100,80,32,color.purple);text(s,'cover-status','传智杯 AI WEB 网页开发挑战赛\nC 组拟参赛作品 · 本地答辩草稿',64,500,1050,90,25,color.muted);

s=page('实训中的工程问题','建议用时35秒。我们关注从项目想法到交付的过程中断。学生可能拿到了代码，却没有明确验收条件；测试记录通过了，却对应旧版需求；文档引用了资料，却没有人工核对是否支持结论。因此设计重点是需求版本、来源核对和人工审核，不把生成的文本自动当作已经实现的成果。这些是产品要解决的问题，教学收益还需要学生试用验证。\n来源：TECHNICAL-MATERIAL中的问题分析，尚无学生成效调查。');
rows(s,[['需求不完整','尾部验收条件必须进入处理，超过边界明确停止。'],['生成与验证混淆','模型建议、人工确认关系、实际执行登记分别保存。'],['版本变化后依据失效','旧结果保留，当前版本重新核对任务与测试。']]);

s=page('统一项目与需求版本','建议用时35秒。浏览器由React、TypeScript和Vite构建，服务端使用Node和Fastify。PostgreSQL保存项目、版本、工具和审核记录，pgvector保存向量。聊天API与Embedding完全独立配置，DeepSeek聊天端点不承担向量生成。凭据只由服务端环境读取。这里是同一项目中的有界工作流，不是多Agent自治系统。\n来源：apps/api、apps/web、apps/embedding；技术稿系统结构。');
node(s,'browser','桌面浏览器','React / TypeScript / Vite',64,180,330);arrow(s,'browser-api',416,235,42,20);
node(s,'api','工程工作流 API','Fastify · 权限与版本核对',480,180,330);arrow(s,'api-store',832,235,42,20);
node(s,'storage','版本与证据存储','PostgreSQL / pgvector',896,180,320);
arrow(s,'api-services',630,323,24,35,'downArrow');text(s,'services-label','独立服务接口',480,364,735,35,22,color.purple);
node(s,'chat','聊天模型','服务端配置 · 可替换',480,410,335,122);node(s,'embedding','本地向量模型','索引与语义检索',881,410,335,122);
text(s,'architecture-rule','项目、需求版本和账号范围统一核对；聊天与向量独立，密钥只在服务端。',64,565,1152,48,25,color.muted);

s=page('Agent 的可核对执行过程','建议用时40秒。Agent先确认输入和需求版本，检索知识，然后调用规划模型。结构、依赖关系和引用ID由确定性工具检查，缺项和依据不足显示为人工审核提示。只有明确采用计划才创建任务。每个阶段保留真实状态和工具结果，失败不写成成功，取消不会自动重放收费请求。这里展示的是工程流程的实现，真实模型规划质量尚未完成本轮评测。\n来源：apps/api/src/agent/routes.ts、lifecycle.ts、trace/domain.ts及Agent恢复8组真实本地检查。');
[['确认需求','人工确认\n确定版本'],['检索资料','实际工具\n原文与来源'],['生成计划','模型建议\n有界输入'],['规则校验','依赖与引用\n缺项提示'],['人工采用','明确审核\n再创建任务']].forEach(([title,detail],i)=>{node(s,`agent-stage-${i}`,title,detail,64+i*236,200,198,164);if(i<4)arrow(s,`agent-edge-${i}`,272+i*236,272,20,16);});
text(s,'agent-feedback-title','校验不通过',64,423,1110,40,30,color.purple,true);text(s,'agent-feedback','最多修正规划一次；仍不通过就保留失败记录。',64,472,1110,45,27,color.muted);
text(s,'agent-boundary','阶段、工具结果与取消均留痕；结构合格不等于需求完整，人工采用不等于测试通过。',64,552,1152,65,25,color.muted);

s=page('知识来源进入代码审查','建议用时40秒。代码审查可以使用当前确认需求和知识资料，也允许用户主动选择仅代码。需求原文和实际检索片段保存为不可变快照。后续版本变化后，这份审查会标记历史，来源仍可回看。平台确定性检查目前只覆盖JavaScript和TypeScript语法，性能和安全等模型意见都属于待验证建议，系统不执行用户提交的代码。\n来源：review-source-desktop截图；review-context-local六组真实数据库、本地向量、HTTP和浏览器联调。聊天为替身。');
await shot(s,'review-source-desktop.png');text(s,'source-description','完整需求与实际原文\n\n保留提交时版本\n\n历史来源明确标记\n\n建议仍须验证',920,191,296,380,29,color.muted);note(s,'实际本地数据库与向量来源；聊天替身。引用存在不代表支持结论。');

s=page('需求条目与验证证据','建议用时45秒。每个需求条目有稳定逻辑标识和原文位置。任务与用例的模型建议关系先进入待确认状态；人工确认两侧关联后，还要明确登记任务与用例的配对。只有当前用例修订、执行时间、结果和说明齐备，才显示可核对的人工证据。修改用例会重置当前执行状态，并保留旧历史。平台不把人工登记冒充自动运行。\n来源：trace/domain.ts、trace/task-test.ts、迁移011和017、task-test-chain-desktop合成截图。');
await shot(s,'task-test-chain-desktop.png');text(s,'chain-description','条目来源\n\n人工确认关联\n\n任务与用例配对\n\n当前修订的执行说明',920,191,296,380,29,color.muted);note(s,'模型建议、人工审核和执行登记分别保存。截图为合成账号。');

s=page('编辑与失败恢复','建议用时40秒。可靠性改进先用回归暴露问题，再修改。快速切项目时，迟到响应不能覆盖当前编辑；保存同时检查项目归属与修订。页面离开提供保存、放弃和取消，保存失败或保存中新增输入不会被丢弃。文档冲突可以核对服务器原文，再明确合并。向量请求共享有界队列，忙碌、失败和有限重试按实际状态显示。\n来源：reliability-browser.mjs、document-workspace组件、rag/embeddings.ts及本轮真实本地报告。');
rows(s,[['跨项目与并发保存','核对项目、修订和已读需求原文，冲突后保留草稿。'],['未保存编辑','保存成功并核对新输入后才离开，取消保持位置。'],['服务失败','读取超时可恢复；模块加载失败保留相邻草稿，重载须先处理编辑。']]);

s=page('完整统计与历史资料管理','建议用时35秒。发现列表上限会隐藏证据，例如200条较新通过遮住第201条失败，或者100份README遮住更早的API文档。现在统计读取完整需求版本，列表有界分页，范围变化要求刷新。知识库较早的资料也能手动重建索引。真实本地验证覆盖201条用例、102份文档和201份知识资料，不是新增装饰性页面。\n来源：verify:test-list六组、verify:document-list六组、verify:knowledge-list五组；均独立合成账号。');
table(s,[['对象','统计或管理范围','实际联调'],['测试','完整版本总数与本页分开','201 条，保留最早失败'],['项目文档','当前需求各类最新摘要','102 份，较早 API 可见'],['知识资料','当前账号完整分页','201 份，最早索引可达']],[250,490,412]);note(s,'同时间戳翻页、账号隔离、游标变化与草稿保护均有检查记录。');

s=page('检索对照实验没有显示提升','建议用时40秒。我们固定15篇合成资料和30个问题，在同一真实本地索引上比较普通查询与增加检索指令，共60次检索。原12个可回答问题的首条和前三命中都是11个；追加12题首条都是9个、前三都是12个。加入指令没有改善这些结果，部分无答案问题还多返回片段，因此生产默认没有更改。针对候选存在却不足以回答的情况，现支持模型明确返回资料不足和零引用，候选原文另列；这只验证返回协议，真实语义判断仍待测。该小样本由开发者编写，没有教师盲评，不能推断问答准确率或教学效果。\n来源：RETRIEVAL-STUDY-V3.md、冻结协议08d1f81及真实本地报告。方法参考BAAI官方模型卡https://huggingface.co/BAAI/bge-small-zh-v1.5。');
table(s,[['问题范围','普通查询 top-1 / top-3','加指令 top-1 / top-3'],['原 12 个可回答问题','11/12，11/12','11/12，11/12'],['追加 12 个可回答问题','9/12，12/12','9/12，12/12'],['无答案 q14 / h13 返回块数','0 / 1','1 / 2']],[420,366,366]);note(s,'同一模型与索引、固定阈值、交替执行；没有聊天调用。追加题不是盲测留出集。');

s=page('桌面操作与动效','建议用时30秒。界面沿用深色工作台设计，统一文字、按钮和状态反馈。长编辑器把主要操作放在可达位置，键盘可跳过重复导航，弹窗管理焦点。持续星环默认静止，用户主动播放，减少动态效果设置下使用静态替代。首页Markdown排版依赖按需加载，下载失败显示完整原文，编辑仍可继续。\n来源：workspace-desktop合成截图、PERFORMANCE-V3、ACCESSIBILITY-V3。星环既有SaturnWebGL与Three.js来源和许可保留，属于装饰而非原创AI算法。');
await shot(s,'workspace-desktop.png',64,155,920,448,{left:0,top:0,right:0,bottom:0.52});text(s,'desktop-description','键盘可达\n\n真实状态\n\n按需加载\n\n减少动态效果',1010,188,206,360,27,color.muted);note(s,'实际本机浏览器首屏节选，完整原图保留。自动扫描不能代替完整无障碍验收。');

s=page('分层验证与能力边界','建议用时35秒。本轮API121项与Embedding4项测试通过，Edge受控浏览器86组通过。Firefox完整85组通过、CDP一项未执行，Windows WebKit完整84组通过、CDP及完整系统强制调色板两项未执行。模块下载失败另在冻结生产构建核对三项恢复行为。还有独立账号的真实数据库、向量和HTTP联调，含四个合成账号竞争向量队列、排队取消与恢复。自动可访问性扫描22个场景未发现工具判定违规，但渐变对比度仍有人审项。真实聊天质量对比、多人课堂容量与师生试用没有完成，不用替身结果代替。\n来源：本轮阶段进度、完整验证报告；Windows WebKit不代表Safari真机。');
rows(s,[['自动与受控测试','API 121 项、Embedding 4 项、Edge 86 组通过。'],['真实本地环境','数据库、向量、HTTP 与桌面流程分开记录验证范围。'],['尚待执行','真实模型质量对比、教师盲评、学生试用及完整无障碍验收。']]);

s=page('参赛交付与后续验证','建议用时30秒。作品已有可运行源码、真实Git历史、迁移、测试和可追溯工程流程。技术稿29页，工程视频草稿7分31秒、1080p，聊天替身和合成数据保持明确标识。正式材料还需要参赛者核对团队资格、提供仓库评审访问、完成真实模型演示和真人听审。公开部署是截图中的可选加分项。缺失评分权重和国赛细则仍标记信息不足，不能据本地验收保证获奖。\n来源：CONTEST-ACCEPTANCE-2026-11、docs/demo-v3/README；本轮无外部上传、推送、部署或比赛提交。');
rows(s,[['已有可复核成果','源码、增量迁移、测试、29 页技术稿与工程演示草稿。'],['仍需参赛者确认','团队资格、仓库评审访问、真实模型演示与最终材料。'],['原创边界','版本与证据流程由本项目实现，第三方视觉和依赖保留许可。']]);

const candidate=path.join(build,'candidate.pptx');await (await PresentationFile.exportPptx(presentation)).save(candidate);
for(const [i,slide] of presentation.slides.items.entries()){const png=await presentation.export({slide,format:'png',scale:1});await fs.writeFile(path.join(build,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));}
await fs.writeFile(path.join(build,'authoring-manifest.json'),JSON.stringify({sourceCommit,slides:pages.length,scope:'editable_defence_draft_not_official_acceptance',font,screenshots:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_local_accounts_real_db_chat_fixture'},null,2));
await fs.writeFile(path.join(root,'docs/DEFENSE-SPEAKER-NOTES-V3.md'),'# 工序智伴答辩讲稿草稿\n\n12页本地演示稿，建议口述约7分钟，需参赛者实际试讲计时。团队信息未填写，不能将替身演示标识移除后冒充真实模型。\n\n'+pages.map((p,i)=>`## ${i+1}. ${p.title}\n\n${p.notes}\n`).join('\n'));
const finalPath=path.join(output,`gongxu-zhiban-defense-v3-${stamp}.pptx`);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath,pythonExecutable:python,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','8','--require-native-table-slide','9'],explicitTotalSlideCount:12,requiredNativeTableOwnerSlides:[8,9],fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,receiptPath:path.join(build,'validation.json')});
console.log(JSON.stringify({slides:pages.length,build,finalPath,visualReview:'pending_every_slide_inspection'}));
