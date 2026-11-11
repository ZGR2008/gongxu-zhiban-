"""Fit the actual continuous UI capture and local slow narration to 07:30.

No source operations or speech are accelerated. The visual marker identifies
the end of setup; only that initial setup and the redundant final hold are cut.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import uuid
import wave

ROOT = Path(__file__).resolve().parents[1]


def local_file(value):
    path = Path(value).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError('Expected an existing project-local file')
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--recording', required=True)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    record_path = local_file(args.recording)
    record = json.loads(record_path.read_text(encoding='utf-8-sig'))
    assert record['status'] == 'recorded' and not record['quick']
    assert record['presentation'] == 'original_site_slow_narration_subtitles_clicks_only'
    assert record['checks'] == {'submissions': 2, 'accepted': 0, 'not_run': 10, 'model_calls': 0}
    assert record['artwork'] == {'autoplay': True, 'controls': False}
    assert record['overlayChecks'] == {'subtitles': 1, 'pointers': 1, 'extraToolbar': False, 'trail': False, 'iframeCount': 0, 'originalRoot': True}
    assert record['paidModelCalls'] == 0 and record['primaryDatabaseModified'] is False
    assert record['pageErrors'] == [] and record['scrolls'] == 0 and record['programmaticPageLoads'] == 1
    narration_path = local_file(record['narrationManifest'])
    narration = json.loads(narration_path.read_text(encoding='utf-8-sig'))
    assert narration['rate'] == -2 and narration['impersonation'] is False and narration['paidModelCalls'] == 0
    voices = {scene['id']: scene for scene in narration['scenes']}
    assert len(voices) == len(record['captions']) == 31
    assert set(voices) == {cue['id'] for cue in record['captions']}
    raw = local_file(record['rawVideo']); ffmpeg = local_file(args.ffmpeg)
    output = Path(args.output_dir).resolve()
    assert output.is_relative_to(ROOT/'output'/'video') and not output.exists()
    spec = importlib.util.spec_from_file_location('media_helpers', ROOT/'scripts'/'assemble-recording-video.py')
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    source = helper.probe(ffmpeg, raw)
    assert source['dimensions'] == [1920, 1080] and source['audioStream'] is None

    # Identify the first frame after the magenta setup marker disappears.
    pixels = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(raw), '-t', '75', '-an',
        '-vf', 'crop=16:16:0:0,scale=1:1:flags=neighbor,fps=30', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], capture_output=True, check=True).stdout
    marked = [i//3 for i in range(0, len(pixels)-2, 3) if pixels[i] > 210 and pixels[i+1] < 65 and pixels[i+2] > 210]
    assert len(marked) >= 6 and max(marked) < 60*30, 'Missing or unexpectedly late video synchronization marker'
    prefix = (max(marked)+1)/30
    assert source['seconds']-prefix >= 449.9, 'Capture is too short for original-speed 07:30 export'
    assert source['seconds']-prefix < 454, 'Unexpected trailing capture; investigate rather than silently cut'

    work = ROOT/'.runtime'/('narrated-730-assembly-'+str(uuid.uuid4()));work.mkdir()
    rate = 22050; pcm = bytearray(450*rate*2);previous_end=0.0
    timeline=[];srt=[]
    for i,cue in enumerate(record['captions']):
        scene=voices[cue['id']];assert cue['text'] == scene['spoken']
        assert hashlib.sha256(scene['spoken'].encode()).hexdigest() == scene['textSha256']
        audio=local_file(scene['audio']);assert hashlib.sha256(audio.read_bytes()).hexdigest() == scene['audioSha256']
        with wave.open(str(audio),'rb') as stream:
            assert (stream.getnchannels(),stream.getsampwidth(),stream.getframerate()) == (1,2,rate)
            data=stream.readframes(stream.getnframes());seconds=stream.getnframes()/rate
        start=float(cue['seconds']);end=start+seconds
        assert start>=previous_end-.005 and end<449.8, 'Spoken cues overlap or exceed the requested duration'
        offset=round(start*rate)*2;pcm[offset:offset+len(data)]=data;previous_end=end
        display_end=float(record['captions'][i+1]['seconds']) if i+1<len(record['captions']) else 450.0
        # Same full sentence displayed by the browser, at the actual cue boundary.
        srt.append(f'{i+1}\n{helper.srt_time(start)} --> {helper.srt_time(display_end)}\n{cue["text"]}\n')
        timeline.append({'id':cue['id'],'startSeconds':start,'speechEndSeconds':end,'subtitleEndSeconds':display_end,'text':cue['text'],'audioSha256':scene['audioSha256']})
    wav=work/'continuous-slow-narration.wav'
    with wave.open(str(wav),'wb') as stream:
        stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(rate);stream.writeframes(pcm)
    output.mkdir(parents=True)
    destination=output/'gongxu-zhiban-7m30s-slow-narration-subtitles.mp4'
    command=[str(ffmpeg),'-hide_banner','-n','-i',str(raw),'-i',str(wav),'-map','0:v:0','-map','1:a:0',
        '-vf',f'trim=start={prefix:.6f}:end={prefix+450:.6f},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=0.2',
        '-af','loudnorm=I=-16:TP=-1.5:LRA=11,apad','-t','450','-frames:v','13500',
        '-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart',str(destination)]
    with (work/'encode.log').open('w',encoding='utf8') as log:
        subprocess.run(command,stdout=log,stderr=log,check=True)
    final=helper.probe(ffmpeg,destination)
    assert final['dimensions']==[1920,1080] and abs(final['seconds']-450)<.04
    assert 'h264' in final['videoStream'] and '30 fps' in final['videoStream'] and 'aac' in final['audioStream']
    decoded=subprocess.run([str(ffmpeg),'-v','error','-i',str(destination),'-f','null','-'],capture_output=True,text=True)
    assert decoded.returncode==0 and not decoded.stderr.strip()
    levels=subprocess.run([str(ffmpeg),'-hide_banner','-i',str(destination),'-vn','-af','volumedetect,silencedetect=noise=-45dB:d=3','-f','null','-'],capture_output=True,text=True,encoding='utf8',errors='replace',check=True)
    mean=re.search(r'mean_volume: ([\-\d.]+) dB',levels.stderr);peak=re.search(r'max_volume: ([\-\d.]+) dB',levels.stderr)
    assert mean and peak and float(mean[1])>-30 and float(peak[1])<0
    silences=[float(value) for value in re.findall(r'silence_duration: ([\d.]+)',levels.stderr)]
    assert max(silences,default=0)<12, 'Unexpected long gap in the narration'
    (output/'gongxu-zhiban-7m30s.srt').write_text('\n'.join(srt),encoding='utf-8-sig')
    (output/'完整旁白与操作.txt').write_text('工序智伴｜7分30秒慢速普通话旁白\n仅网站、字幕与点击反馈；本机电脑合成声音，无人物声音模仿。\n\n'+'\n\n'.join(f'{helper.srt_time(c["startSeconds"])}  {voices[c["id"]]["title"]}\n{c["text"]}' for c in timeline),encoding='utf8')
    qa=output/'visual-qa';qa.mkdir();shots=[]
    for second in [5,20,80,120,155,205,255,310,365,400,435,448]:
        target=qa/f'{second:03d}s.png'
        subprocess.run([str(ffmpeg),'-v','error','-n','-ss',str(second),'-i',str(destination),'-frames:v','1',str(target)],capture_output=True,check=True)
        shots.append({'file':str(target),'seconds':second})
    from PIL import Image,ImageDraw
    sheet=Image.new('RGB',(1920,900),'#0a0614');draw=ImageDraw.Draw(sheet)
    for i,shot in enumerate(shots):
        with Image.open(shot['file']) as picture:thumb=picture.resize((480,270))
        x=i%4*480;y=i//4*300;sheet.paste(thumb,(x,y+30));draw.text((x+12,y+7),f'{shot["seconds"]//60:02d}:{shot["seconds"]%60:02d}',fill='white')
    sheet.save(qa/'contact-sheet.png')
    manifest={'file':str(destination),'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),
        'seconds':final['seconds'],'media':final,'voice':narration['voice'],'voiceRate':-2,'speechAcceleration':False,
        'speechSeconds':round(sum(x['audioSeconds'] for x in narration['scenes']),3),'timeline':timeline,
        'subtitles':'burned_into_real_website_capture_and_matching_srt','mouse':'click_pointer_and_feedback_no_trail_no_wheel',
        'sourceRecording':str(record_path),'sourceRawSha256':hashlib.sha256(raw.read_bytes()).hexdigest(),
        'sourceSeconds':source['seconds'],'setupTrimSeconds':prefix,'retainedSourceRange':[prefix,prefix+450],
        'continuousCapture':True,'operationCuts':0,'operationAcceleration':False,'programmaticPageLoads':1,
        'paidModelCalls':0,'primaryDatabaseModified':False,'browserChecks':record['checks'],'artwork':record['artwork'],
        'audioChecks':{'meanDb':float(mean[1]),'peakDb':float(peak[1]),'longestSilenceSeconds':max(silences,default=0)},
        'validation':{'fullDecode':'passed','duration450Seconds':'passed','audioPresent':'passed','sampledVisualReview':'pending','humanFullWatch':'not_performed'},
        'screenshots':shots,'boundary':'Synthetic accounts use real website and isolated database; existing teaching designs, no new cloud-model generation or independent teacher review.'}
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'file':str(destination),'bytes':destination.stat().st_size,'seconds':final['seconds'],'voice':narration['voice'],'rate':-2,'decode':'passed','audio':manifest['audioChecks']},ensure_ascii=False))


if __name__=='__main__':main()
