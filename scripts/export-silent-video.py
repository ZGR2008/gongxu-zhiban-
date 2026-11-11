"""Export one continuous real UI capture to exactly eight minutes, without audio."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
def local_file(value:str)->Path:
    p=Path(value).resolve()
    if not p.is_relative_to(ROOT) or not p.is_file(): raise ValueError('Existing project-local input required')
    return p

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--recording',required=True)
    parser.add_argument('--ffmpeg',required=True)
    parser.add_argument('--output-dir',required=True)
    args=parser.parse_args()
    source=local_file(args.recording)
    record=json.loads(source.read_text(encoding='utf-8-sig'))
    assert record['status']=='recorded' and not record['quick']
    assert record['scope']=='continuous_isolated_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_real_ui'
    assert record['programmaticPageLoads']==1 and record['pageErrors']==[]
    assert record['audio'] is False and record['paidModelCalls']==0 and record['primaryDatabaseModified'] is False
    assert record['checks']=={'submissions':2,'accepted':0,'not_run':10,'model_calls':0}
    raw=local_file(record['rawVideo']); ffmpeg=local_file(args.ffmpeg)
    output=Path(args.output_dir).resolve()
    assert output.is_relative_to(ROOT/'output'/'video') and not output.exists()
    spec=importlib.util.spec_from_file_location('existing_media_checks',ROOT/'scripts'/'assemble-recording-video.py')
    helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
    media=helpers.probe(ffmpeg,raw)
    assert media['dimensions']==[1920,1080] and media['audioStream'] is None
    factor=480/media['seconds']
    if not .7<=factor<=1.3: raise ValueError('Timing adaptation would be too large; simplify and re-record instead')
    output.mkdir(parents=True)
    destination=output/'gongxu-zhiban-8min-subtitles-only-20261107.mp4'
    command=[str(ffmpeg),'-hide_banner','-n','-i',str(raw),'-map','0:v:0','-an','-vf',f'setpts={factor:.12f}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration=2','-frames:v','14400','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(destination)]
    with (output/'encode.log').open('w',encoding='utf-8') as log: subprocess.run(command,stdout=log,stderr=log,check=True)
    final=helpers.probe(ffmpeg,destination)
    assert final['dimensions']==[1920,1080] and final['audioStream'] is None
    assert abs(final['seconds']-480)<.04 and 'h264' in final['videoStream'] and '30 fps' in final['videoStream']
    check=subprocess.run([str(ffmpeg),'-v','error','-i',str(destination),'-f','null','-'],capture_output=True,text=True)
    assert check.returncode==0 and not check.stderr.strip()
    qa=output/'visual-qa';qa.mkdir()
    shots=[]
    for i,second in enumerate([12,60,115,175,235,295,355,415,465],1):
        target=qa/f'{i:02d}-{second:03d}s.png'
        subprocess.run([str(ffmpeg),'-v','error','-n','-ss',str(second),'-i',str(destination),'-frames:v','1',str(target)],check=True,capture_output=True)
        shots.append({'file':str(target),'seconds':second})
    from PIL import Image,ImageDraw,ImageChops
    sheet=Image.new('RGB',(1440,900),'#0a0614');draw=ImageDraw.Draw(sheet)
    for i,shot in enumerate(shots):
        with Image.open(shot['file']) as pic: thumb=pic.resize((480,270))
        x=i%3*480;y=i//3*300;sheet.paste(thumb,(x,y+30));draw.text((x+12,y+7),f"{shot['seconds']//60:02d}:{shot['seconds']%60:02d}",fill='white')
    sheet.save(qa/'contact-sheet.png')
    # Find a moving-pointer sample in the real encoded opening, excluding the
    # permanent cyan links in the subtitle panel. Pixel counts only select an
    # inspection frame; they are not a substitute for visual confirmation.
    sample=subprocess.run([str(ffmpeg),'-v','error','-ss','8','-t','24','-i',str(destination),'-vf','crop=1920:922:0:0,scale=640:308,fps=8','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],check=True,capture_output=True).stdout
    size=640*308*3; best=(-1,0)
    for n in range(len(sample)//size):
        pic=Image.frombytes('RGB',(640,308),sample[n*size:(n+1)*size]);r,g,blue=pic.split()
        mask=ImageChops.multiply(r.point(lambda v:255 if v<150 else 0),g.point(lambda v:255 if v>135 else 0))
        mask=ImageChops.multiply(mask,blue.point(lambda v:255 if v>150 else 0))
        mask=ImageChops.multiply(mask,ImageChops.subtract(blue,r).point(lambda v:255 if v>50 else 0))
        count=mask.histogram()[255]
        if count>best[0]: best=(count,n)
    trail_time=8+best[1]/8
    subprocess.run([str(ffmpeg),'-v','error','-n','-ss',str(trail_time),'-i',str(destination),'-frames:v','1',str(qa/'mouse-trail.png')],check=True,capture_output=True)
    transcript=['工序智伴｜八分钟无配音字幕视频','字幕随实际操作直接录入画面。下面保留字幕原文和章节，不把参考时间当作逐帧字幕文件。','']
    for cap in record['captions']:transcript.extend([cap['chapter'],cap['text'],''])
    (output/'SUBTITLES-AND-OPERATIONS.txt').write_text('\n'.join(transcript),encoding='utf-8')
    manifest={'file':str(destination),'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'seconds':final['seconds'],'media':final,'audioTracks':0,'subtitles':'burned_in_with_the_actual_ui_capture','mouse':'visible_arrow_continuous_trail_and_click_rings','mouseInspectionCandidate':{'seconds':trail_time,'cyanPixelsInDownscaledSample':best[0],'image':str(qa/'mouse-trail.png')},'sourceRecording':str(source),'sourceRawSha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'continuousCapture':True,'cuts':0,'sourceSeconds':media['seconds'],'timeAdaptationFactor':factor,'timingNote':'The complete capture is uniformly fitted to 480 seconds; no interface actions or waiting states are cut. This is not a performance benchmark.','programmaticPageLoads':1,'paidModelCalls':0,'primaryDataModified':False,'browserChecks':record['checks'],'validation':{'fullDecode':'passed','eightMinutes':'passed','noAudioStream':'passed','sampledVisualReview':'pending'},'screenshots':shots,'boundary':'Isolated REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b accounts operate the actual UI. Initial teaching materials are prepared; historical AI material is a different REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b case, with no new cloud request. No independent human quality review or classroom outcome is claimed.'}
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'file':str(destination),'seconds':final['seconds'],'bytes':destination.stat().st_size,'audioTracks':0,'fullDecode':'passed'},ensure_ascii=False))

if __name__=='__main__':main()
