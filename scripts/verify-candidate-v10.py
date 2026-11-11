"""Read-only candidate checks plus safe extraction into a fresh local directory.

No config, credential, model call, database, upload or account access. The source
ZIP is deliberately different from a history-preserving reviewer repository.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse, hashlib, json, re, stat, subprocess, zipfile
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '098e581c9c88f7bec260641c5ff453fea462afec'
parser = argparse.ArgumentParser()
parser.add_argument('--archive', type=Path, required=True)
parser.add_argument('--pdf', type=Path, required=True)
args = parser.parse_args()
archive, pdf = args.archive.resolve(), args.pdf.resolve()
assert archive.is_relative_to(ROOT.parent / '.review-export') and archive.suffix == '.zip'
assert pdf.is_relative_to(ROOT / 'output/pdf') and pdf.suffix == '.pdf'
digest = lambda data: hashlib.sha256(data).hexdigest()
business_paths = ['apps/api/src', 'apps/web/src', 'apps/embedding/src', 'apps/api/migrations']
changed = sorted(set(subprocess.check_output(['git', 'diff', '--name-only', BASELINE, '--', *business_paths], cwd=ROOT, text=True).splitlines()) | set(subprocess.check_output(['git','ls-files','--others','--exclude-standard','--',*business_paths],cwd=ROOT,text=True).splitlines()))
evidence = json.loads((ROOT/'docs/verification/review-v10.json').read_text(encoding='utf-8'))
assert evidence['startCommit'] == BASELINE
assert set(changed) == set(evidence['businessSourceChanged']), 'Unreviewed business changes present'
assert evidence['offline']['status'] == 'passed' and evidence['longPlanIntegration']['status'] == 'passed'
for path, expected in evidence['verifiedSourceHashes'].items():
    assert digest((ROOT/path).read_bytes()) == expected, 'Source changed since verification: ' + path
required = {
    'README.md', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'compose.yaml',
    'apps/api/.env.example', 'apps/api/package.json', 'apps/web/package.json',
    'apps/api/migrations/025_assignment_versions.sql',
    'docs/COMPLIANCE-CHECKLIST-V10.md', 'docs/COMPLIANCE-SOURCES-V9.md',
    'docs/ORIGINALITY-AND-LICENSE-V8.md', 'docs/BACKEND-SCOPE-QUESTION-V10.md',
    'docs/VIDEO-ACCEPTANCE-V10.md', 'docs/REVIEWER-ACCESS-V9.md',
    'docs/DEMO-SCRIPT-V10.md', 'docs/DEMO-OPERATIONS-V10.md', 'docs/FINAL-REVIEW-V10.md',
    'docs/verification/review-v10.json', 'docs/verification/licenses-v8.json',
    'docs/verification/licenses-v9.json', 'docs/verification/history-v10.json',
    'scripts/export-review.test.py', 'scripts/verify.mjs',
    'docs/LONG-PLAN-DIAGNOSIS-V10.md', 'docs/OFFLINE-QUALITY-REVIEW-V10.md',
    'docs/HISTORY-SECURITY-V10.md', 'evaluation/fixtures/long-plan-v7-saved-responses.json',
    'evaluation/fixtures/long-plan-v10-merge-candidate.json',
    'docs/AI-LONG-PLAN-V10.md', 'docs/AI-QUALITY-PRELIMINARY-V10.md', 'docs/verification/ai-long-plan-v10.json',
    'docs/TEAM-WALKTHROUGH-V10.md', 'docs/CONTRIBUTION-RECORD-V10.md', 'docs/PENDING-INFORMATION-V9.md',
    'docs/PENDING-INFORMATION-V10.md',
    'apps/web/public/previews/vendor/three/LICENSE',
    'apps/web/public/previews/vendor/saturn-webgl/LICENSE',
    'apps/web/public/THIRD-PARTY-LICENSES.txt', 'apps/embedding/THIRD_PARTY_NOTICES.md',
}
forbidden = {'node_modules', '.git', '.venv', '.runtime', '__pycache__', 'output', 'logs', 'uploads', 'dist', 'build', '.models'}
token = re.compile(rb'\b(?:sk-[A-Za-z0-9_-]{18,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b')
private_key = re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----')
extract = archive.parent / ('candidate-extract-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
extract.mkdir(exist_ok=False)
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None, 'ZIP CRC failed'
    names = bundle.namelist()
    assert len(names) == len(set(names)), 'Duplicate ZIP entries'
    files = set()
    for item in bundle.infolist():
        name = item.filename
        path = PurePosixPath(name)
        assert not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name
        assert path.parts[0] == 'gongxu-zhiban' and len(path.parts) > 1
        assert not any(part in forbidden for part in path.parts[1:])
        assert not ('.env' in path.name and not path.name.endswith('.env.example'))
        assert path.suffix.lower() not in {'.log', '.pem', '.key', '.p12', '.pfx', '.sqlite', '.db', '.dump', '.bak', '.mp4', '.webm'}
        assert not stat.S_ISLNK(item.external_attr >> 16), 'Symlink ZIP entry'
        relative = PurePosixPath(*path.parts[1:]).as_posix()
        files.add(relative)
        data = bundle.read(item)
        assert not token.search(data) and not private_key.search(data), 'Credential-like pattern present; values suppressed'
        target = extract.joinpath(*path.parts)
        assert target.resolve().is_relative_to(extract)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    assert required <= files, 'Required candidate files missing: ' + ', '.join(sorted(required - files))
    manifest = json.loads(bundle.read('gongxu-zhiban/SOURCE-PACKAGE-MANIFEST.json'))
    assert manifest['realEnvironmentRead'] is False and manifest['originalProjectModified'] is False
    listed = {entry['path'] for entry in manifest['files']}
    assert files == listed | {'SOURCE-PACKAGE-MANIFEST.json'}, 'Unlisted archive file'
    for entry in manifest['files']:
        data = (extract / 'gongxu-zhiban' / entry['path']).read_bytes()
        assert len(data) == entry['bytes'] and digest(data) == entry['sha256'], 'Extracted file integrity failure'
    migrations = [p for p in files if re.fullmatch(r'apps/api/migrations/\d+_[^/]+\.sql', p)]
    assert len(migrations) == 25

reader = PdfReader(pdf)
assert 1 <= len(reader.pages) <= 30
content = '\n'.join(page.extract_text() or '' for page in reader.pages)
for phrase in ['第九届', '均待报名后台核验', '产品统筹', '后端验证', '工序智伴', '长需求', '后4段未调用', '独立人审0', '需求', '架构', '部署', '总结']:
    assert phrase in content, 'PDF required scope/limitation missing: ' + phrase
for phrase in ['用户确认', '此前用户指定', '没有复制他人代码', '届次待核验', '项目统筹 / 后端业务', '暂关联']:
    assert phrase not in content, 'PDF handover/overbroad claim remains'
pdf_manifest = json.loads(pdf.with_name(pdf.stem + '-manifest.json').read_text(encoding='utf-8'))
assert pdf_manifest['sha256'] == digest(pdf.read_bytes())
assert pdf_manifest['visualReview'] == 'all_rendered_pages_inspected', 'All PDF pages require actual visual review'
report = {
    'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
    'baselineCommit': BASELINE, 'businessSourceChanged': changed,
    'archive': str(archive), 'bytes': archive.stat().st_size,
    'sha256': digest(archive.read_bytes()), 'entries': len(names),
    'manifestFilesVerified': len(manifest['files']), 'migrations': len(migrations),
    'requiredFiles': sorted(required), 'crcPassed': True, 'actualExtractionPassed': True,
    'credentialPatternScanPassed': True, 'realEnvironmentRead': False,
    'historyIncluded': False, 'reviewerRepositoryAccess': 'not_verified',
    'pdf': {'path': str(pdf), 'pages': len(reader.pages), 'sha256': digest(pdf.read_bytes()), 'textScopeChecked': True, 'visualReview': pdf_manifest['visualReview']},
    'extractedDirectory': str(extract / 'gongxu-zhiban'),
    'paidModelCalls': 0, 'remoteOperations': 0,
    'limitations': ['Pattern scanning cannot prove absence of every unknown secret or personal field.', 'ZIP is not a history-preserving reviewer repository.', 'Eligibility, applicability of full rules, independent human review and final video remain separate checks.'],
}
report_path = archive.parent / 'candidate-verification.json'
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'status': report['status'], 'report': str(report_path), 'entries': len(names), 'bytes': report['bytes'], 'extractedDirectory': report['extractedDirectory']}, ensure_ascii=False))
