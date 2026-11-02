export const qualityPolicy={provider:'DeepSeek',model:'deepseek-flash',limitCalls:17,phaseLimits:{long:13,teacher:4},limitUSD:0.5,maxOutputTokens:8192,inputUSDPerMillion:0.3,outputUSDPerMillion:1.2,pricingSource:'https://api-docs.deepseek.com/quick_start/pricing/',pricingChecked:'2026-11-01',thinking:'disabled',temperature:0.3,automaticRetries:0};
export function reserveQualityCall(records,phase,messages){
 if(!Object.hasOwn(qualityPolicy.phaseLimits,phase)||!Array.isArray(messages)||messages.length!==2||messages[0].role!=='system'||messages[1].role!=='user')throw Error('Request outside approved protocol');
 if(records.length>=17||records.filter(r=>r.phase===phase).length>=qualityPolicy.phaseLimits[phase])throw Error('Approved call limit reached');
 const bytes=Buffer.byteLength(JSON.stringify(messages),'utf8');if(bytes>100000)throw Error('Input exceeds reviewed scope');
 const reserveUSD=((bytes+1024)*qualityPolicy.inputUSDPerMillion+qualityPolicy.maxOutputTokens*qualityPolicy.outputUSDPerMillion)/1e6;
 if(records.reduce((s,r)=>s+r.reserveUSD,0)+reserveUSD>qualityPolicy.limitUSD)throw Error('Approved conservative reservation exhausted');
 return {number:records.length+1,phase,inputBytes:bytes,reserveUSD,status:'reserved'};
}
