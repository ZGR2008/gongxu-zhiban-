"""Assemble real local UI recordings with disclosed REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b data/local speech.

Only project-local JSON, videos and WAV files are accepted. No account, database,
environment configuration, network or paid model is read or invoked here.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]


def local_file(raw: str, suffixes: tuple[str, ...] = ()) -> Path:
    path = Path(raw).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError('Only existing project-local files are accepted.')
    if suffixes and path.suffix.lower() not in suffixes:
        raise ValueError('Unexpected input format.')
    return path


def read_json(raw: str) -> dict:
    return json.loads(local_file(raw, ('.json',)).read_text(encoding='utf-8-sig'))


def probe(ffmpeg: Path, media: Path) -> dict:
    result = subprocess.run([str(ffmpeg), '-hide_banner', '-i', str(media)], capture_output=True, text=True, encoding='utf-8', errors='replace')
    description = result.stderr
    match = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', description)
    if match:
        duration = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
    else:
        # Some browser WebM containers omit their duration header. Decode the
        # existing local clip to obtain its real timestamp; do not guess time.
        decoded = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(media), '-map', '0:v:0', '-progress', 'pipe:1', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
        stamps = re.findall(r'^out_time_us=(\d+)$', decoded.stdout, re.M)
        if decoded.returncode or decoded.stderr.strip() or not stamps:
            raise ValueError(f'Cannot determine media duration for {media.name}.')
        duration = int(stamps[-1]) / 1_000_000
    video_line = next((line.strip() for line in description.splitlines() if 'Video:' in line), None)
    audio_line = next((line.strip() for line in description.splitlines() if 'Audio:' in line), None)
    dimensions = re.search(r'\b(\d{3,5})x(\d{3,5})\b', video_line or '')
    return {'seconds': duration, 'videoStream': video_line, 'audioStream': audio_line,
            'dimensions': [int(dimensions[1]), int(dimensions[2])] if dimensions else None}


def content_filter(metadata: dict, rectangle: dict | None) -> str:
    dimensions = metadata.get('dimensions')
    if dimensions == [1920, 960] and rectangle is None:
        return 'setsar=1'
    if not rectangle or rectangle.get('verifiedAgainstScreenshot') is not True:
        raise ValueError('Recorded canvas differs from the UI viewport. Verify a real frame against its screenshot and provide contentRect; do not shrink or crop blindly.')
    x, y, width, height = (rectangle.get(key) for key in ('x', 'y', 'width', 'height'))
    if not all(isinstance(value, int) for value in (x, y, width, height)) or width != 1920 or height != 960 or x < 0 or y < 0:
        raise ValueError('Verified contentRect must retain the full 1920x960 UI viewport.')
    if not dimensions or x + width > dimensions[0] or y + height > dimensions[1]:
        raise ValueError('Verified contentRect exceeds the recorded canvas.')
    return f'crop={width}:{height}:{x}:{y},setsar=1'


def ass_time(value: float) -> str:
    centi = round(value * 100)
    return f'{centi // 360000}:{centi // 6000 % 60:02d}:{centi // 100 % 60:02d}.{centi % 100:02d}'


def srt_time(value: float) -> str:
    ms = round(value * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def caption_chunks(text: str) -> list[str]:
    # Prefer punctuation and avoid a long Chinese line masking the application.
    clauses = re.findall(r'[^，。；！？：、,;!?\n]+[，。；！？：、,;!?]?', text)
    chunks: list[str] = []
    for clause in clauses:
        value = clause.strip()
        while len(value) > 30:
            split = value.rfind(' ', 12, 31)
            if split < 12:
                split = 30
            chunks.append(value[:split].strip())
            value = value[split:].strip()
        if value:
            chunks.append(value)
    merged: list[str] = []
    for chunk in chunks:
        if merged and len(merged[-1]) + len(chunk) <= 30:
            merged[-1] += chunk
        else:
            merged.append(chunk)
    return merged


def ass_escape(value: str) -> str:
    return value.replace('\\', '／').replace('{', '（').replace('}', '）').replace('\n', ' ')


ASS_HEADER = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Microsoft YaHei,34,&H00FFFFFF,&H00FFFFFF,&H0014060A,&H0014060A,0,0,0,0,100,100,0,0,1,1,0,2,40,40,14,1
Style: Chapter,Microsoft YaHei,24,&H00E9C4D1,&H00FFFFFF,&H0014060A,&H0014060A,0,0,0,0,100,100,0,0,1,0,0,7,26,26,974,1
Style: Scope,Microsoft YaHei,22,&H00FFFF99,&H00FFFFFF,&H0014060A,&H0014060A,0,0,0,0,100,100,0,0,1,0,0,9,26,26,974,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--recording', required=True)
    parser.add_argument('--narration', required=True)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    recording = read_json(args.recording)
    narration = read_json(args.narration)
    if recording.get('status') != 'recorded' or recording.get('scope') != 'isolated_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_real_ui' or recording.get('paidModelCalls') != 0:
        raise ValueError('Expected a complete isolated REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-data UI recording with no paid calls.')
    if recording.get('pageErrors') or recording.get('modelFixtures', 0) != 0:
        raise ValueError('Unresolved browser errors or model fixtures require a different disclosure and must not be silently accepted.')
    if narration.get('scope') != 'installed_local_mandarin_voice_no_cloud' or narration.get('paidModelCalls') != 0:
        raise ValueError('Only disclosed installed local narration is accepted.')
    ffmpeg = local_file(args.ffmpeg, ('.exe',))
    output = Path(args.output_dir).resolve()
    if not output.is_relative_to((ROOT / 'output' / 'video').resolve()) or output.exists():
        raise ValueError('Use a new project output/video subdirectory; old output is protected.')
    raw_scenes = recording.get('scenes', [])
    audio_scenes = {scene['id']: scene for scene in narration.get('scenes', [])}
    if not 1 <= len(raw_scenes) <= 20 or len(audio_scenes) != len(raw_scenes):
        raise ValueError('Recording and narration must have exactly matching scenes.')
    ids = [scene['id'] for scene in raw_scenes]
    if len(set(ids)) != len(ids) or set(ids) != set(audio_scenes):
        raise ValueError('Scene identifiers mismatch or repeat.')
    prepared = []
    for scene in raw_scenes:
        key = scene['id']
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,50}', key):
            raise ValueError('Unsafe scene identifier.')
        audio = audio_scenes[key]
        video = local_file(scene['rawVideo'], ('.webm', '.mp4', '.mkv'))
        wav = local_file(audio['audio'], ('.wav',))
        text = audio['spoken']
        chunks = caption_chunks(text)
        if not chunks or re.sub(r'\s+', '', ''.join(chunks)) != re.sub(r'\s+', '', text):
            raise ValueError('Subtitles must preserve all spoken text, apart from whitespace.')
        if hashlib.sha256(text.encode('utf-8')).hexdigest() != audio['textSha256'] or hashlib.sha256(wav.read_bytes()).hexdigest() != audio['audioSha256']:
            raise ValueError('Narration hashes mismatch; original evidence must be preserved.')
        with wave.open(str(wav), 'rb') as stream:
            audio_seconds = stream.getnframes() / stream.getframerate()
        raw_probe = probe(ffmpeg, video)
        filter_prefix = content_filter(raw_probe, scene.get('contentRect', recording.get('contentRect')))
        retained_end = raw_probe['seconds']
        edit = scene.get('edit')
        if edit:
            if edit.get('type') != 'remove_redundant_static_end_hold' or edit.get('reviewedNoActionsRemoved') is not True:
                raise ValueError('Only an explicitly reviewed redundant end hold can be shortened.')
            evidence = read_json(edit['evidenceFile'])
            check = next((item for item in evidence.get('checks', []) if item['id'] == key), None)
            if not check or check.get('visualReview') != 'assistant_sample_frame_review_no_material_change' or check.get('sampleFrequencyHz') != 2 or check.get('maxMeanRGBDifference', 255) >= 0.5:
                raise ValueError('Missing sampled-frame and visual evidence for the proposed cut.')
            retained_end = float(edit['retainedEndSeconds'])
            if abs(retained_end - check['retainedEndSeconds']) > 0.001 or abs(raw_probe['seconds'] - check['rawSeconds']) > 0.05 or retained_end < 3 or retained_end >= raw_probe['seconds']:
                raise ValueError('Retained source range does not match the reviewed cut.')
            if retained_end - check['verifiedIntervalStartSeconds'] < 3:
                raise ValueError('Keep at least three seconds of the final stable page before the cut.')
            if hashlib.sha256(video.read_bytes()).hexdigest() != edit.get('sourceSha256'):
                raise ValueError('Original recording has changed since the cut was reviewed.')
            filter_prefix = f'trim=start=0:end={retained_end:.3f},setpts=PTS-STARTPTS,' + filter_prefix
        duration = math.ceil(max(float(audio['durationSec']), audio_seconds + 2, retained_end))
        prepared.append({**scene, 'videoPath': video, 'audioPath': wav, 'spoken': text, 'audioSeconds': audio_seconds, 'rawSeconds': raw_probe['seconds'], 'retainedEndSeconds': retained_end, 'durationSeconds': duration, 'filterPrefix': filter_prefix})
    total = sum(scene['durationSeconds'] for scene in prepared)
    if not 300 <= total <= 480:
        raise ValueError(f'Actual assembly would take {total}s; adjust script/recording to the 5–8 minute range without disguising or accelerating actions.')
    output.mkdir(parents=True)
    work = output / 'assembly'
    work.mkdir()
    events = []
    srt = []; timeline = []; cursor = 0.0; cue = 0; caption_validation = []
    for scene in prepared:
        start = cursor; end = start + scene['durationSeconds']
        events.append(f'Dialogue: 1,{ass_time(start)},{ass_time(end)},Chapter,,0,0,0,,{ass_escape(scene["title"])}')
        scope = '合成教学数据 · 自动化界面操作 · 电脑配音'
        if scene['id'] == 'evidence':
            scope += ' · 另一案例历史响应（无现场调用）'
        events.append(f'Dialogue: 2,{ass_time(start)},{ass_time(end)},Scope,,0,0,0,,{scope}')
        chunks = caption_chunks(scene['spoken']); weight = sum(map(len, chunks)); caption_cursor = start
        cue_intervals = []
        for chunk in chunks:
            stop = caption_cursor + scene['audioSeconds'] * len(chunk) / weight
            if stop <= caption_cursor or stop > end + 0.001:
                raise ValueError('Subtitle timing falls outside the actual scene.')
            events.append(f'Dialogue: 0,{ass_time(caption_cursor)},{ass_time(stop)},Caption,,0,0,0,,{ass_escape(chunk)}')
            cue += 1
            srt.append(f'{cue}\n{srt_time(caption_cursor)} --> {srt_time(stop)}\n{chunk}\n')
            cue_intervals.append((round(caption_cursor, 2), round(stop, 2)))
            caption_cursor = stop
        if any(left[1] > right[0] for left, right in zip(cue_intervals, cue_intervals[1:])):
            raise ValueError('Rounded subtitle timings overlap.')
        caption_validation.append({'id': scene['id'], 'chunks': len(chunks), 'completeSpokenText': True, 'overlap': False, 'withinScene': True})
        chapter_file = work / (scene['id'] + '.mp4')
        command = [str(ffmpeg), '-hide_banner', '-n', '-i', str(scene['videoPath']), '-i', str(scene['audioPath']),
                   '-map', '0:v:0', '-map', '1:a:0', '-vf',
                   scene['filterPrefix'] + ',fps=30,tpad=stop_mode=clone:stop_duration=480,pad=1920:1080:0:0:color=0x0A0614',
                   '-af', 'apad', '-t', str(scene['durationSeconds']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
                   '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', str(chapter_file)]
        with (work / (scene['id'] + '-encode.log')).open('w', encoding='utf-8') as log:
            subprocess.run(command, stdout=log, stderr=log, check=True)
        timeline.append({'id': scene['id'], 'title': scene['title'], 'startSeconds': start, 'durationSeconds': scene['durationSeconds'], 'rawVideoSeconds': scene['rawSeconds'], 'audioSeconds': round(scene['audioSeconds'], 3), 'videoEvidenceSha256': hashlib.sha256(scene['videoPath'].read_bytes()).hexdigest(), 'actionsSpeed': 'original_not_accelerated', 'retainedSourceRangeSeconds': [0, scene['retainedEndSeconds']], 'removedRedundantEndSeconds': round(scene['rawSeconds']-scene['retainedEndSeconds'], 3), 'addedLastFrameHoldSeconds': round(scene['durationSeconds']-scene['retainedEndSeconds'], 3), 'editingEvidence': scene.get('edit')})
        cursor = end
        print('Encoded chapter: ' + scene['id'], flush=True)
    (work / 'concat.txt').write_text(''.join(f"file '{scene['id']}.mp4'\n" for scene in prepared), encoding='utf-8')
    ass_path = output / 'gongxu-zhiban-narration.ass'
    ass_path.write_text(ASS_HEADER + '\n'.join(events) + '\n', encoding='utf-8-sig')
    (output / 'gongxu-zhiban-narration.srt').write_text('\n'.join(srt), encoding='utf-8')
    # A relative caption path avoids exposing workstation paths in the filter syntax.
    (work / 'captions.ass').write_bytes(ass_path.read_bytes())
    destination = output / 'gongxu-zhiban-demo-20261103.mp4'
    command = [str(ffmpeg), '-hide_banner', '-n', '-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-vf',
               "ass=filename=captions.ass:fontsdir='C\\:/Windows/Fonts'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', str(destination)]
    with (work / 'final-encode.log').open('w', encoding='utf-8') as log:
        subprocess.run(command, cwd=work, stdout=log, stderr=log, check=True)
    metadata = probe(ffmpeg, destination)
    if not metadata['videoStream'] or not all(value in metadata['videoStream'] for value in ('h264', '1920x1080', '30 fps')) or not metadata['audioStream'] or 'aac' not in metadata['audioStream']:
        raise ValueError('Final codecs or dimensions do not match the intended delivery format.')
    if not 300 <= metadata['seconds'] <= 480 or abs(metadata['seconds'] - total) > 1:
        raise ValueError('Actual final duration is outside the verified assembly range.')
    decode = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(destination), '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if decode.returncode != 0 or decode.stderr.strip():
        (work / 'decode-errors.log').write_text(decode.stderr, encoding='utf-8')
        raise ValueError('Full decode found errors; output is not verified.')
    manifest = {'schema': 'local-recording-video-v1', 'createdAt': datetime.now(timezone.utc).isoformat(),
                'file': str(destination), 'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                'scope': recording['scope'], 'paidModelCalls': 0, 'voice': narration.get('voice'), 'computerNarration': True,
                'captionAlignment': 'phrase-proportional-not-forced-aligned-requires-human-listening', 'validation': {'fullDecode': 'passed', 'visualAndListeningReview': 'pending'},
                'media': metadata, 'plannedSeconds': total, 'scenes': timeline, 'officialSubmissionReady': False,
                'captionValidation': caption_validation,
                'contentRect': recording.get('contentRect'),
                'boundary': 'Synthetic demo data and automated operations of the real local interface; no real teacher quality review, classroom outcomes or new model calls. Historical model responses use a different REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b case.'}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'file': str(destination), 'bytes': destination.stat().st_size, 'seconds': metadata['seconds'], 'fullDecode': 'passed'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
