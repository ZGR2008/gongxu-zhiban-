export type IndexCompatibility='current'|'model_changed'|'incomplete'|'awaiting_embedding'|'unconfigured';
export function indexCompatibility(status:string,configured:boolean,chunkCount:number,indexedChunks:number,currentChunks:number):IndexCompatibility{
 if(!configured)return 'unconfigured';
 if(status!=='ready')return 'awaiting_embedding';
 if(chunkCount===0||indexedChunks!==chunkCount)return 'incomplete';
 return currentChunks===chunkCount?'current':'model_changed';
}
