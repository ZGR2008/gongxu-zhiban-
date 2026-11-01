// Focused updates to the existing editable v3 deck. Original file is never written.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const arg=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const runtime=arg('runtime'),skill=arg('skill'),python=arg('python');
if(!runtime||!skill||!python)throw Error('Provide the verified local runtime, skill and Python paths. No downloads or remote authoring.');
process.env.RUNTIME_NODE_MODULES=runtime;
const {PresentationFile,FileBlob}=await import(pathToFileURL(path.join(runtime,'@oai/artifact-tool/dist/artifact_tool.mjs')).href);
const source=path.join(root,'output/presentations/gongxu-zhiban-defense-v3-2026-11-01T02-06-24-722Z.pptx');
const sourceSha=createHash('sha256').update(await fs.readFile(source)).digest('hex');
const presentation=await PresentationFile.importPptx(await FileBlob.load(source));
if(presentation.slides.items.length!==12)throw Error('Unexpected source deck; inspect before updating.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const build=path.join(root,'tmp/presentations','v4-'+stamp);await fs.mkdir(build,{recursive:true});
await fs.writeFile(path.join(build,'before-inspect.json'),JSON.stringify(await presentation.inspect({kind:'slide,textbox,image,table,notes',maxChars:100000}),null,2));
const titles=['工序智伴','实训中的工程问题','统一项目与需求版本','Agent 的可核对执行过程','知识来源进入代码审查','需求条目与验证证据','编辑与失败恢复','完整统计与历史资料管理','检索对照实验没有显示提升','桌面操作与动效','分层验证与能力边界','参赛交付与后续验证'];
function slide(n){const s=presentation.slides.items[n-1];if(String(s.shapes.items.find(x=>x.name==='slide-title')?.text)!==titles[n-1])throw Error('Unexpected slide identity');return s;}
function replace(n,name,text){const target=slide(n).shapes.items.find(x=>x.name===name);if(!target)throw Error('Source text anchor missing');const old=String(target.text);target.text.replace(old,text);}
function notes(n,text){slide(n).speakerNotes.text=text;}
replace(1,'cover-status','传智杯 AI WEB 网页开发挑战赛\nC 组拟参赛作品 · v4 本地答辩草稿');
replace(2,'detail-0','完整原文分段、位置与人工审核已实现，长需求生成仍保留安全限制。');
replace(6,'chain-description','真实缺口与下一步\n\n人工确认关联\n\n按需展开高级审核\n\n当前修订的执行说明');
replace(7,'topic-0','双窗口执行登记');
replace(7,'detail-0','执行修订独立比较，旧快照返回冲突，本地输入保留待核对。');
replace(7,'topic-1','任务书创建与未保存输入');
replace(7,'detail-1','慢请求不抢走新页面，提交期间的新名称保留。');
replace(7,'topic-2','深链接与失败恢复');
replace(7,'detail-2','快捷导航独立加载账号目录，读取失败保留原内容并提供重试。');
replace(9,'evidence-scope','v3 历史检索结果，本轮未重跑；不是聊天质量或教学效果的提升证明。');
replace(10,'desktop-description','真实缺口\n\n键盘可达\n\n180ms 状态反馈\n\n减少动态效果');
replace(11,'detail-0','API 125 项、Embedding 4 项、根脚本 74 项、Python 7 项分别通过。');
replace(11,'topic-1','受控浏览器与本地联调');
replace(11,'detail-1','Edge 96 组受控流程，数据库统一入口 17 步分别验证。');
replace(12,'detail-0','源码、21 个增量迁移、29 页技术稿与新版工程演示草稿。');
notes(2,'建议用时35秒。需求尾部可能包含关键验收条件，所以本轮保留完整原文，用连续片段、原文偏移、条目标识和哈希帮助人工核对。分段处理及合并检查已用受控处理器验证，但还没有接入完整生产模型队列。超过两万字符仍明确阻止生成。这个限制避免把缺段结果展示成完整计划。模型建议、人工确认和执行登记始终分别保存。\n来源：LONG-REQUIREMENTS-V4、trace/segments.ts、迁移021。');
notes(6,'建议用时45秒。页面根据当前版本真实数据显示缺少任务、用例、配对或当前执行证据，并提供下一步入口。高级审核按需展开，折叠不会丢草稿，也不自动确认关系。修改需求或测试定义后，旧证据保留但不能冒充当前验证。条目标识以已有版本规则生成，改写内容或边界可能产生新标识，需要人工处理变更关系。\n来源：trace-next-action.ts、RequirementTrace、TaskTestEvidence及受控浏览器回归。截图是独立合成项目，聊天替身。');
notes(7,'建议用时45秒。先用回归复现三个风险再修复。执行记录与用例定义各自有修订，顺序或并发提交旧执行令牌都返回409。界面保留输入，必须主动读取比较，再明确提交。任务书创建复用统一草稿保护与请求归属，创建在服务器成功也不会抢走已离开的页面。深链接的快捷导航独立加载当前账号目录，旧账号迟到结果不会回填。\n来源：执行并发5组真实数据库、任务书及快捷导航修改前失败和修复后受控浏览器记录；CONTINUATION-V4。');
notes(9,slide(9).speakerNotes.text+'\n版本说明：本页保留v3已经取得的历史检索测量，本轮未重复执行该研究，不计入v4新模型效果。');
notes(10,'建议用时30秒。保留统一工作台风格，重点改善需求与证据审核。当前缺项和下一步由真实状态计算，配对表单按需展开，保存反馈使用约180毫秒的透明度和轻微位移，减少动态效果时关闭。检查1366、1536、1920与1024像素宽度及CSS缩放，原生浏览器菜单缩放仍待验证。截图为实际本地界面，不是设计稿。\n来源：本轮浏览器报告、styles.css、trace-next-action.ts。既有Three.js等第三方视觉保留许可，不作为算法创新。');
notes(11,'建议用时40秒。统一离线入口覆盖类型、构建、API125项、Embedding4项、根脚本74项和Python打包7项。Edge完整96组受控浏览器通过，Firefox新增及受影响10组通过。Windows WebKit新增及受影响10组通过，保留了最初测试等待不足的失败记录与修正过程。数据库统一入口17步完成，包含执行冲突和分段审核。自动可访问性扫描24场景未发现工具判定违规，仍保留人工待核。不同层级不能相加为全系统通过率。真实模型质量、原生缩放及师生试用尚未执行。\n来源：docs/verification/review-v4.json；Windows WebKit不代表Safari真机。');
notes(12,'建议用时30秒。材料已按v4实现同步，PDF实际页数和视频实际时长、分辨率以独立文件检查清单为准。视频展示完整工程流程、执行冲突和长需求审核，明确使用合成账号、真实本地数据库与向量、聊天替身、普通话本地合成旁白，仍需真人听审和真实模型演示。模型评测已准备12个调用帧，等待明确范围批准。团队资格、远程仓库评审访问和最终提交由参赛者确认。本轮没有外部上传、部署、推送或比赛提交。\n来源：CONTEST-ACCEPTANCE-2026-11、docs/demo-v4/README、EVALUATION-V4。缺失评分权重和国赛规则为信息不足。');
for(const [n,name] of [[5,'review-source-desktop.png'],[6,'task-test-chain-desktop.png'],[10,'workspace-desktop.png']]){
 const image=slide(n).images.items[0];if(!image)throw Error('Source image missing');
 const frame=image.frame;image.replace({blob:new Uint8Array(await fs.readFile(path.join(root,'docs/screenshots/review-v4',name))),contentType:'image/png',fit:'contain',alt:'v4实际本地浏览器画面，合成账号、真实数据库与Embedding、聊天替身'});
 image.frame=frame;image.crop={left:0,top:0,right:0,bottom:0};image.fit='contain';
}
await fs.writeFile(path.join(build,'after-inspect.json'),JSON.stringify(await presentation.inspect({kind:'slide,textbox,image,table,notes',maxChars:100000}),null,2));
const pages=presentation.slides.items.map(s=>({title:String(s.shapes.items.find(x=>x.name==='slide-title').text),notes:s.speakerNotes.text}));
const candidate=path.join(build,'candidate.pptx');await(await PresentationFile.exportPptx(presentation)).save(candidate);
for(const [i,s] of presentation.slides.items.entries()){const png=await presentation.export({slide:s,format:'png',scale:1});await fs.writeFile(path.join(build,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));}
await fs.writeFile(path.join(root,'docs/DEFENSE-SPEAKER-NOTES-V4.md'),'# 工序智伴v4答辩讲稿草稿\n\n沿用既有12页演示稿并同步本轮实现。建议口述约7分钟，未做真人试讲计时。团队信息待真实填写，合成数据和聊天替身标识必须保留。\n\n'+pages.map((p,i)=>`## ${i+1}. ${p.title}\n\n${p.notes}\n`).join('\n'));
const finalPath=path.join(root,'output/presentations',`gongxu-zhiban-defense-v4-${stamp}.pptx`);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath,pythonExecutable:python,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','8','--require-native-table-slide','9'],explicitTotalSlideCount:12,requiredNativeTableOwnerSlides:[8,9],fontPolicy:{basis:'reference',families:['Microsoft YaHei'],referencePath:source,referenceSha256:sourceSha},verifyArtifactToolImport:true,receiptPath:path.join(build,'validation.json')});
if(createHash('sha256').update(await fs.readFile(source)).digest('hex')!==sourceSha)throw Error('Original deck changed');
await fs.writeFile(path.join(build,'authoring-manifest.json'),JSON.stringify({source: path.relative(root,source),sourceSha256:sourceSha,sourceProvenance:sourceProvenance(root),slides:12,finalPath,visualReview:'pending_every_slide_inspection',method:'import_existing_deck_focused_text_notes_image_edits'},null,2));
console.log(JSON.stringify({finalPath,build,slides:12,visualReview:'pending_every_slide_inspection'}));
