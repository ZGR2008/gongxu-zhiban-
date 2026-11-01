"""Decode the entire draft and extract review frames; no business data or network."""
from pathlib import Path
import argparse,hashlib,json,re,subprocess
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--video',required=True);parser.add_argument('--ffmpeg',required=True);parser.add_argument('--confirm-frame-review',action='store_true');args=parser.parse_args()
video=Path(args.video).resolve();assert video.is_relative_to(ROOT/'output/video')
manifest_path=video.with_suffix('.json');manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
assert hashlib.sha256(video.read_bytes()).hexdigest()==manifest['sha256']
encoder=str(Path(args.ffmpeg).resolve())
metadata=subprocess.run([encoder,'-hide_banner','-i',str(video)],capture_output=True,text=True,encoding='utf-8',errors='replace').stderr
assert 'Video: h264' in metadata and '1920x1080' in metadata and 'Audio: aac' in metadata
m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',metadata);assert m
seconds=int(m[1])*3600+int(m[2])*60+float(m[3]);assert 300<=seconds<=480 and abs(seconds-manifest['seconds'])<.2
subprocess.run([encoder,'-v','error','-i',str(video),'-f','null','-'],check=True,capture_output=True)
folder=ROOT/'tmp/video'/video.stem;folder.mkdir(parents=True,exist_ok=True)
frames=[]
for scene in manifest['scenes']:
 sample=scene['startSeconds']+min(scene['durationSeconds']-3,15)
 frame=folder/(scene['id']+'.jpg')
 subprocess.run([encoder,'-v','error','-y','-ss',str(sample),'-i',str(video),'-frames:v','1','-q:v','2',str(frame)],check=True,capture_output=True)
 frames.append((frame,scene['title'],sample))
for start in range(0,len(frames),4):
 sheet=Image.new('RGB',(1920,1120),'#221b31');draw=ImageDraw.Draw(sheet)
 for slot,(frame,title,sample) in enumerate(frames[start:start+4]):
  im=Image.open(frame);im.thumbnail((950,535));x=(slot%2)*960+5;y=(slot//2)*560+20;sheet.paste(im,(x,y));draw.text((x,y-16),f'{frame.stem}: {sample:.2f}s',fill='white')
 sheet.save(folder/f'sheet-{start//4+1}.jpg')
manifest['decodedSeconds']=seconds;manifest['validation']='full_decode_passed_frames_pending_review';manifest['reviewFrames']=[{'scene':p.stem,'sampleSeconds':t} for p,_,t in frames];manifest['humanAudioReview']='not_executed';manifest['officialSubmissionReady']=False
if args.confirm_frame_review:manifest['validation']='full_decode_passed_and_all_scene_samples_visually_reviewed'
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Decoded {seconds:.2f}s at 1920x1080 H.264 / AAC; {len(frames)} scene frames extracted; human audio timing/voice review still pending.')
