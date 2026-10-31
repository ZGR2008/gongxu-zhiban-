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
    stage='desktop_layout';for(const [width,height,zoom] of [[1366,768,1],[1536,864,1.25],[1920,1080,1.5]]){
      await page.setViewportSize({width,height});await page.evaluate(value=>{document.documentElement.style.zoom=String(value);},zoom);await page.waitForTimeout(120);
      const metrics=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,width:document.documentElement.scrollWidth}));assert.ok(metrics.width<=metrics.viewport+2,`layout overflow at ${width}/${zoom}`);
      await trace.getByRole('button',{name:'刷新追踪'}).scrollIntoViewIfNeeded();assert.ok(await trace.getByRole('button',{name:'刷新追踪'}).isEnabled());
      await page.screenshot({path:fileURLToPath(new URL(`desktop-${width}-csszoom-${zoom}.png`,directory))});
    }
    await page.evaluate(()=>{document.documentElement.style.zoom='1';});await page.setViewportSize({width:1536,height:960});
    stage='tests_page';await page.goto(`${origin}/projects/${projectId}/tests`);await page.getByLabel('测试来源需求版本').waitFor();await page.locator('.case-item').first().waitFor();
    await page.screenshot({path:fileURLToPath(new URL('tests-desktop.png',directory))});
    assert.equal(errors.length,0);
    return {scope:'real_local_http_and_database_synthetic_account_model_fixture',screenshots:6,layouts:['1366x768','1536x864 CSS zoom 125%','1920x1080 CSS zoom 150%'],nativeBrowserMenuZoom:'not_executed',keyboardAndTraceSave:'passed'};
  }catch(error){console.log(`Desktop failure at ${stage}`);console.log((error.stack??'').split('\n').filter(line=>line.includes('local-desktop-check.mjs')).slice(0,2).join('\n'));await page.screenshot({path:fileURLToPath(new URL('desktop-failed.png',directory))});throw error;}
  finally{await context.close();await browser.close();}
}
