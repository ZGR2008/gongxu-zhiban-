/** Defense in depth for browser checks that have not requested paid model calls.
 * Page-level controlled fixtures can still intercept a request before this context guard.
 */
export async function preventPaidModelRequests(context){
  await context.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const paid=route.request().method()==='POST'&&(/\/(requirements\/analyze|agent\/runs|code-reviews|test-cases|documents\/generate|knowledge\/answer)$/.test(path));
    if(paid)return route.fulfill({status:403,json:{error:'paid_model_request_not_authorized_in_this_check'}});
    return route.continue();
  });
}
