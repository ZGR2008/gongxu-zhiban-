type Item={id:string;coverage:{confirmedTasks:number;confirmedCases:number;stale:number;manualEvidence:number}};
type Pair={itemId:string;status:string;evidence:{state:string;manualEvidence:boolean}};
export function traceNextAction(item:Item,pairs:Pair[],current:boolean){
 if(!current)return {stage:'history',title:'查看历史依据',detail:'历史版本只读，不能代表当前需求已经验证。',pending:false};
 const c=item.coverage,related=pairs.filter(p=>p.itemId===item.id&&p.status==='confirmed');
 if(c.stale>0||related.some(p=>p.evidence.state==='stale_case'))return {stage:'review',title:'复核已失效的关联',detail:'用例定义已变化，先比较原文和当前修订，再决定是否重新确认。',pending:true};
 if(!c.confirmedTasks)return {stage:'task',title:'审核需求与任务的关系',detail:'选择能实现此条目的任务，说明对应的交付要求；模型建议不会自动被采用。',pending:true};
 if(!c.confirmedCases)return {stage:'case',title:'审核需求与用例的关系',detail:'确认用例检查了哪些验收条件，并核对步骤和预期。',pending:true};
 if(!related.length)return {stage:'pair',title:'明确任务由哪个用例检查',detail:'需求已分别关联任务和用例；展开下方配对审核，记录它们之间的验证关系。',pending:true};
 if(related.some(p=>!p.evidence.manualEvidence))return {stage:'execution',title:'补齐当前修订的执行证据',detail:'仍有已确认配对缺少有效的人工通过记录。请核对失败、阻塞、未执行或说明不足，再如实登记。',pending:true};
 return {stage:'delivery',title:'人工复核后进入交付检查',detail:'已确认配对有人工通过记录，仍需判断是否覆盖全部验收条件；平台未自动认证需求正确性。',pending:false};
}
