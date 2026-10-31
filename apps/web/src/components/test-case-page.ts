export type TestCaseTotals={requirementVersionId:string|null;requirementVersion:number|null;caseRevision:number;capturedAt:string;total:number;passed:number;failed:number;blocked:number;notRun:number};
export type TestCasePage<T>={cases:T[];summary:TestCaseTotals;page:{limit:number;hasMore:boolean;nextCursor:string|null}};
/** Missing, inconsistent or differently scoped totals must never look like zero
 * failures. The list is only one page and cannot substitute for these totals. */
export function totalsForVersion(value:TestCaseTotals|null|undefined,versionId:string|undefined):TestCaseTotals|null{
 if(!value||!versionId||value.requirementVersionId!==versionId)return null;
 const counts=[value.total,value.passed,value.failed,value.blocked,value.notRun,value.caseRevision];
 return counts.every(n=>Number.isSafeInteger(n)&&n>=0)&&value.total===value.passed+value.failed+value.blocked+value.notRun?value:null;
}
