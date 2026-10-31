import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

/** Runs only against the caller's synthetic account and ephemeral local API.
 * Browser -> real HTTP -> real local DB. Model replies in that API are explicit fixtures.
 * No token is written to disk, included in screenshots or reported.
 */
export async function checkLocalDesktop({apiAddress,authorization,projectId,directory}){
  const origin='http://127.0.0.1:5173';
  if(!new URL(apiAddress).hostname.match(/^(127\.0\.0\.1|localhost)$/))throw Error('Loopback API required');
  const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  const context=await browser.newContext({viewport:{width:1536,height:960},reducedMotion:'reduce'});
  await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),authorization.slice(7));
  const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',()=>errors.push('page_error'));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    const response=await route.fetch({url:apiAddress+url.pathname.slice(4)+url.search});await route.fulfill({response});
  });
  let stage='open_requirements';
  try{
    await page.goto(`${origin}/projects/${projectId}/requirements`);await page.locator('#requirement').waitFor();
    stage='load_trace';const trace=page.getByRole('region',{name:'需求到验证证据追踪'});await trace.getByText('原文与版本来源',{exact:true}).waitFor();
    await page.screenshot({path:fileURLToPath(new URL('requirements-desktop.png',directory))});
    await trace.evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:fileURLToPath(new URL('trace-desktop.png',directory))});
    stage='trace_form';await trace.getByLabel('关联类型',{exact:true}).selectOption('case');
    const target=trace.getByLabel('当前版本对象',{exact:true});const values=await target.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(Boolean));assert.ok(values.length);
    await target.selectOption(values[0]);await trace.getByLabel('审核依据',{exact:true}).fill('合成桌面审核：用例覆盖审批登记，仍须人工执行。');
    stage='unsaved_guard';const leave=page.getByRole('link',{name:'我的项目',exact:true}).first();await leave.click();const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();await page.keyboard.press('Escape');
    assert.ok((await trace.getByLabel('审核依据',{exact:true}).inputValue()).includes('合成桌面审核'));
    stage='save_trace';await trace.getByRole('button',{name:'确认关联',exact:true}).click();await trace.getByText('审核已保存。关联确认不等于需求已验证。',{exact:true}).waitFor();
    const detail=await page.request.get(`${apiAddress}/projects/${projectId}/trace`,{headers:{authorization}});const data=await detail.json();assert.ok(data.items.some(i=>i.coverage.confirmedCases===1));assert.ok(data.items.every(i=>i.coverage.manualEvidence===0));
    stage='task_test_chain_real_write';
    // This ephemeral API uses the script's explicit model fixture; no remote model calls.
    const generated=await page.request.post(`${apiAddress}/projects/${projectId}/agent/runs`,{headers:{authorization},data:{requirementId:data.version.id}});assert.equal(generated.status(),201);
    const run=(await generated.json()).run;const adopted=await page.request.post(`${apiAddress}/projects/${projectId}/agent/runs/${run.id}/confirm`,{headers:{authorization},data:{acknowledged:true,note:'本机浏览器联调合成计划审核，不代表实训成果已通过'}});assert.equal(adopted.status(),200);const task=(await adopted.json()).tasks[0];
    await trace.getByRole('button',{name:'刷新追踪',exact:true}).click();await trace.getByLabel('关联类型',{exact:true}).selectOption('task');await trace.getByLabel('当前版本对象',{exact:true}).selectOption(task.id);
    await trace.getByLabel('审核依据',{exact:true}).fill('合成任务直接实现此条审批需求');await trace.getByRole('button',{name:'确认关联',exact:true}).click();await trace.getByText('审核已保存。关联确认不等于需求已验证。',{exact:true}).waitFor();
    const chain=trace.getByRole('region',{name:'任务与测试验证链'});await chain.getByLabel('验证链开发任务').selectOption(task.id);await chain.getByLabel('验证链测试用例').selectOption(values[0]);await chain.getByLabel('任务验证依据').fill('用例检查审批任务的登记结果，执行仍为未执行');
    await chain.getByRole('button',{name:'确认任务与用例配对',exact:true}).click();await chain.getByText(/尚无当前修订执行记录/).waitFor();
    const paired=await page.request.get(`${apiAddress}/projects/${projectId}/trace`,{headers:{authorization}});const pair=(await paired.json()).taskTests[0];assert.equal(pair.taskId,task.id);assert.equal(pair.caseId,values[0]);assert.equal(pair.evidence.manualEvidence,false);
    await chain.scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('task-test-chain-desktop.png',directory))});
    stage='desktop_layout';for(const [width,height,zoom] of [[1366,768,1],[1536,864,1.25],[1920,1080,1.5]]){
      await page.setViewportSize({width,height});await page.evaluate(value=>{document.documentElement.style.zoom=String(value);},zoom);await page.waitForTimeout(120);
      const metrics=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,width:document.documentElement.scrollWidth}));assert.ok(metrics.width<=metrics.viewport+2,`layout overflow at ${width}/${zoom}`);
      await trace.getByRole('button',{name:'刷新追踪'}).scrollIntoViewIfNeeded();assert.ok(await trace.getByRole('button',{name:'刷新追踪'}).isEnabled());
      await page.screenshot({path:fileURLToPath(new URL(`desktop-${width}-csszoom-${zoom}.png`,directory))});
    }
    await page.evaluate(()=>{document.documentElement.style.zoom='1';});await page.setViewportSize({width:1536,height:960});
    stage='tests_page';await page.goto(`${origin}/projects/${projectId}/tests`);await page.getByLabel('测试来源需求版本').waitFor();await page.locator('.case-item').first().waitFor();
    await page.screenshot({path:fileURLToPath(new URL('tests-desktop.png',directory))});
    stage='real_document_edit_and_history';await page.goto(`${origin}/projects/${projectId}/documents`);await page.locator('#doc-content').waitFor();
    await page.getByText('无生成来源快照，须人工核对',{exact:true}).waitFor();
    await page.locator('#doc-content').fill('真实本机HTTP保存的合成文档，用于核对修订历史。');await page.getByRole('button',{name:/保存文档/}).click();await page.getByText('已保存修订 4。',{exact:true}).waitFor();
    await page.getByRole('button',{name:/修订记录 展开/}).click();await page.locator('.document-history summary').first().waitFor();assert.equal(await page.locator('.document-history summary').count(),3);
    await page.locator('.document-history summary').first().click();await page.getByRole('region',{name:'历史修订 3'}).waitFor();
    await page.screenshot({path:fileURLToPath(new URL('documents-desktop.png',directory))});
    stage='real_code_draft_save_without_model';await page.goto(`${origin}/projects/${projectId}/reviews`);await page.getByRole('button',{name:'重新读取草稿',exact:true}).waitFor();
    await page.locator('#code-input').fill('const localDraftOnly = "合成代码，不执行、不调用模型";');await page.getByRole('link',{name:'我的项目',exact:true}).first().click();
    await page.getByRole('dialog',{name:'保留未保存的编辑'}).getByRole('button',{name:'保存并继续'}).click();await page.waitForURL('**/projects');
    await page.goto(`${origin}/projects/${projectId}/reviews`);await page.waitForFunction(()=>document.querySelector('#code-input')?.value.includes('localDraftOnly'));
    const savedCode=await page.request.get(`${apiAddress}/projects/${projectId}/code-draft`,{headers:{authorization}});assert.equal((await savedCode.json()).draft.code,'const localDraftOnly = "合成代码，不执行、不调用模型";');
    const reviewList=await page.request.get(`${apiAddress}/projects/${projectId}/code-reviews`,{headers:{authorization}});assert.equal((await reviewList.json()).reviews.length,0);
    await page.screenshot({path:fileURLToPath(new URL('code-draft-desktop.png',directory))});
    assert.equal(errors.length,0);
    return {scope:'real_local_http_and_database_synthetic_account_model_fixture',screenshots:9,layouts:['1366x768','1536x864 CSS zoom 125%','1920x1080 CSS zoom 150%'],nativeBrowserMenuZoom:'not_executed',keyboardAndTraceSave:'passed',taskTestPairing:'passed',documentSaveAndHistory:'passed',codeDraftSaveAndReturnWithoutAi:'passed'};
  }catch(error){console.log(`Desktop failure at ${stage}`);console.log((error.stack??'').split('\n').filter(line=>line.includes('local-desktop-check.mjs')).slice(0,2).join('\n'));await page.screenshot({path:fileURLToPath(new URL('desktop-failed.png',directory))});throw error;}
  finally{await context.close();await browser.close();}
}
