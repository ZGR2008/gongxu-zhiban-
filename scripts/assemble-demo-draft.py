"""Assemble an explicitly labelled local engineering draft, without network access.

The recording must come from record-demo-draft.mjs and contain only a synthetic
account. This tool never opens .env, a database, tokens or uploaded user files.
Use a trusted local FFmpeg binary; it is a development tool, not redistributed.
"""
from pathlib import Path
from datetime import datetime
import argparse,hashlib,json,math,re,subprocess,wave

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--recording',required=True)
parser.add_argument('--ffmpeg',required=True)
args=parser.parse_args()
recording=Path(args.recording).resolve()
if not recording.is_relative_to((ROOT/'.runtime').resolve()):raise ValueError('Recording must be in project .runtime')
report=json.loads((recording/'recording.json').read_text(encoding='utf-8'))
assert report['status']=='recorded' and not report['quick'] and not report['pageErrors']
assert report['model']=='controlled_fixture_no_remote_calls'
video=recording/report['video'];assert video.is_file() and video.parent==recording
scenes=report['scenes'];duration=scenes[-1]['startSeconds']+scenes[-1]['durationSeconds']
assert 300<=duration<=480, 'This planned draft should fit the screenshot video duration range.'
audio_dir=(ROOT/report.get('narrationDirectory','.runtime/demo-v3-narration')).resolve()
assert audio_dir.is_relative_to((ROOT/'.runtime').resolve())
output=ROOT/'output/video';output.mkdir(parents=True,exist_ok=True)
name='gongxu-zhiban-demo-v3-draft'
if (output/(name+'.mp4')).exists():name+='-'+datetime.now().strftime('%Y%m%d-%H%M%S')
dest=output/(name+'.mp4')
work=recording/'assembly';work.mkdir(exist_ok=True)

with wave.open(str(audio_dir/(scenes[0]['id']+'.wav')),'rb') as audio:
 channels=audio.getnchannels();sample_width=audio.getsampwidth();rate=audio.getframerate()
block=channels*sample_width
mixed=bytearray(math.ceil((duration+1)*rate)*block)
for scene in scenes:
 assert re.fullmatch('[a-z]+',scene['id'])
 if 'audioSha256' in scene:
  assert hashlib.sha256((audio_dir/(scene['id']+'.wav')).read_bytes()).hexdigest()==scene['audioSha256']
  assert hashlib.sha256(scene['narration'].encode('utf-8')).hexdigest()==scene['narrationSha256']
 with wave.open(str(audio_dir/(scene['id']+'.wav')),'rb') as audio:
  assert (audio.getnchannels(),audio.getsampwidth(),audio.getframerate())==(channels,sample_width,rate)
  data=audio.readframes(audio.getnframes())
 start=int((scene['startSeconds']+.3)*rate)*block
 mixed[start:start+len(data)]=data
with wave.open(str(work/'narration.wav'),'wb') as audio:
 audio.setnchannels(channels);audio.setsampwidth(sample_width);audio.setframerate(rate);audio.writeframes(mixed)

def ass_time(value):
 centi=round(value*100);return f'{centi//360000}:{centi//6000%60:02d}:{centi//100%60:02d}.{centi%100:02d}'
def srt_time(value):
 ms=round(value*1000);return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
def wrap(value):return '\\N'.join(value[i:i+42] for i in range(0,len(value),42))
header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Microsoft YaHei,30,&H00FFFFFF,&H00FFFFFF,&H0014060A,&H0014060A,0,0,0,0,100,100,0,0,1,1,0,2,90,90,15,1
Style: Chapter,Microsoft YaHei,22,&H00E9C4D1,&H00FFFFFF,&H0014060A,&H0014060A,0,0,0,0,100,100,0,0,1,0,0,7,24,24,970,1
Style: Scope,Microsoft YaHei,22,&H00FFFF99,&H00FFFFFF,&H0014060A,&H0014060A,0,0,0,0,100,100,0,0,1,0,0,9,24,24,970,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
events=[f'Dialogue: 2,0:00:00.00,{ass_time(duration)},Scope,,0,0,0,,工程草稿 · 合成数据 · 聊天模型替身 · 本地合成语音']
srt=[];cue=1
for scene in scenes:
 start=scene['startSeconds'];end=start+scene['durationSeconds']
 events.append(f'Dialogue: 1,{ass_time(start)},{ass_time(end)},Chapter,,0,0,0,,{scene["title"]}')
 clauses=re.findall(r'[^。；！？]+[。；！？]?',scene['narration']);total=sum(map(len,clauses));cursor=start+.3
 for clause in clauses:
  stop=cursor+scene['audioSeconds']*len(clause)/total
  events.append(f'Dialogue: 0,{ass_time(cursor)},{ass_time(stop)},Caption,,0,0,0,,{wrap(clause)}')
  srt.append(f'{cue}\n{srt_time(cursor)} --> {srt_time(stop)}\n{clause}\n');cue+=1;cursor=stop
(work/'captions.ass').write_text(header+'\n'.join(events)+'\n',encoding='utf-8-sig')
(output/(name+'.srt')).write_text('\n'.join(srt),encoding='utf-8')
command=[str(Path(args.ffmpeg).resolve()),'-hide_banner','-n','-i',str(video),'-i',str(work/'narration.wav'),'-map','0:v:0','-map','1:a:0','-vf',"drawbox=x=0:y=960:w=1920:h=120:color=0x0A0614:t=fill,ass=filename=captions.ass:fontsdir='C\\:/Windows/Fonts'",'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','128k','-movflags','+faststart','-t',str(round(duration,3)),str(dest)]
with (work/'encode.log').open('w',encoding='utf-8') as log:
 subprocess.run(command,cwd=work,stdout=log,stderr=log,check=True)
manifest={'file':dest.name,'seconds':round(duration,3),'dimensions':[1920,1080],'codec':'H.264 / AAC','fps':30,'scope':report['scope'],'voice':report['voice'],'captionAlignment':'clause_proportional_needs_final_human_timing_review','scenes':[{'id':s['id'],'title':s['title'],'startSeconds':s['startSeconds'],'durationSeconds':s['durationSeconds']} for s in scenes],'rawRecordingSha256':hashlib.sha256(video.read_bytes()).hexdigest(),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size,'validation':'pending_decode_and_frame_review','officialSubmissionReady':False}
manifest['sourceCommit']=report.get('sourceCommit');manifest['sourceModified']=report.get('sourceModified')
manifest['narrationHashes']=[{'id':s['id'],'textSha256':s.get('narrationSha256'),'audioSha256':s.get('audioSha256')} for s in scenes]
(output/(name+'.json')).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Created {dest.name}: {round(duration,1)} seconds, {dest.stat().st_size} bytes. Decode and visual review required.')
