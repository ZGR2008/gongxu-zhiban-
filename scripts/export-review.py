"""Create a conservative, sanitized source review ZIP without reading real .env files.

Run with Python 3. PDF fixture sanitization additionally needs pypdf; existing local
review-tool installations may be used. No network, Git mutation or original-file writes.
The result stays under the workspace export directory; copy to Desktop separately.
"""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
from io import BytesIO
import hashlib
import json
import os
import re
import sys
import uuid
import zipfile
import argparse

parser=argparse.ArgumentParser(description='Create a local sanitized source review copy, never an external upload.')
parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1],help='Source root; optional for isolated export regression fixtures.')
parser.add_argument('--version',choices=['v4','v5','v6','v7','v8'],default='v4',help='Explicit edition; old export commands keep their version.')
args=parser.parse_args()
ROOT = args.source.resolve()
STAMP = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
EXPORT = ROOT.parent / '.review-export' / (args.version + '-' + STAMP)
STAGE = EXPORT / 'gongxu-zhiban'
ROOT_FILES = {'.editorconfig','.gitattributes','.gitignore','compose.yaml','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','README.md'}
SKIP_DIRS = {'node_modules','.venv','venv','__pycache__','.git','.runtime','.models','models','.cache','.vite','.turbo','dist','build','coverage','uploads','storage','output','tmp','.setup','.vscode','.idea'}
DOCS = {'CONTEST-ACCEPTANCE-2026-11.md','OPTIMIZATION-PROGRESS.md','TRACEABILITY-AND-RECOVERY.md','FINAL-REVIEW-2026-11.md','STARTUP-AND-VERIFICATION.md','TECHNICAL-MATERIAL.md','DEMO-WALKTHROUGH.md','SOURCE-PACKAGE.md','CONTINUATION-2026-11-01.md','REFERENCE-REVIEW-V3.md','FINAL-REVIEW-V3-2026-11-01.md','PERFORMANCE-V3.md'}
DOCS.add('ACCESSIBILITY-V3.md')
DOCS.add('RETRIEVAL-STUDY-V3.md')
DOCS.update({'DEFENSE-DECK-V3.md','DEFENSE-SPEAKER-NOTES-V3.md'})
DOCS.update({'CONTINUATION-V4.md','LONG-REQUIREMENTS-V4.md','REFERENCE-REVIEW-V4.md','EVALUATION-V4.md','FINAL-REVIEW-V4.md','DEFENSE-DECK-V4.md','DEFENSE-SPEAKER-NOTES-V4.md'})
DOCS.add('AI-EVALUATION-V4-2026-11-01.md')
DOCS.update({'CONTINUATION-V5.md','LONG-REQUIREMENTS-V5.md','AI-REVIEW-PACK-V5.md','DEMO-SCRIPT-V5.md','DEMO-OPERATIONS-V5.md','FINAL-REVIEW-V5.md'})
DOCS.update({'CONTINUATION-V6.md','TEACHING-AND-PERMISSIONS-V6.md','KNOWLEDGE-CURRICULUM-V6.md','REFERENCE-REVIEW-V6.md','AI-REVIEW-PACK-V6.md','DEMO-SCRIPT-V6.md','DEMO-OPERATIONS-V6.md','FINAL-REVIEW-V6.md'})
DOCS.update({'CONTINUATION-V7.md','TEACHING-VERSIONS-V7.md','AI-REVIEW-PACK-V7.md','DEMO-SCRIPT-V7.md','DEMO-OPERATIONS-V7.md','FINAL-REVIEW-V7.md','CURRICULUM-REVIEW-V7.md'})
DOCS.update({'CONTINUATION-V8.md','COMPLIANCE-CHECKLIST-V8.md','COMPLIANCE-SOURCES-V8.md','ORIGINALITY-AND-LICENSE-V8.md','COMMITTEE-QUESTIONS-V8.md','DEMO-SCRIPT-V8.md','DEMO-OPERATIONS-V8.md','VIDEO-ACCEPTANCE-V8.md','REVIEWER-ACCESS-V8.md','FINAL-REVIEW-V8.md'})
CURATED_SCREENSHOTS={'docs/screenshots/review-v2/trace-desktop.png','docs/screenshots/review-v3/task-test-chain-desktop.png','docs/screenshots/review-v3/documents-desktop.png','docs/screenshots/review-v3/review-source-desktop.png','docs/screenshots/review-v3/growth-current-desktop.png','docs/screenshots/review-v3/workspace-desktop.png'}
CURATED_SCREENSHOTS.update('docs/screenshots/review-v4/'+name+'.png' for name in ['task-test-chain-desktop','documents-desktop','review-source-desktop','growth-current-desktop','workspace-desktop','requirement-segments-desktop','execution-conflict-desktop'])
CURATED_SCREENSHOTS.add('docs/screenshots/review-v5/adopted-desktop.png')
JSON_FILES={'package.json','evaluation/record-template.json','evaluation/cases.v1.json','evaluation/retrieval.v1.json','apps/embedding/model-manifest.json','apps/web/public/previews/vendor/manifest.json','docs/verification/review-v2.json','docs/verification/review-v3.json','docs/demo-v3/storyboard.json'}
TEXT = {'.ts','.tsx','.js','.mjs','.cjs','.json','.yaml','.yml','.md','.css','.html','.sql','.txt','.svg','.glsl','.ps1','.py','.sh','.toml'}
JSON_FILES.add('evaluation/retrieval-query-study.v1.json')
JSON_FILES.update({'docs/verification/review-v4.json','docs/demo-v4/storyboard.json'})
JSON_FILES.add('docs/verification/ai-evaluation-v4.json')
JSON_FILES.add('docs/verification/review-v5.json')
JSON_FILES.update({'docs/verification/review-v6.json','docs/verification/knowledge-v6.json'})
CURATED_SCREENSHOTS.update('docs/screenshots/review-v6/'+name+'.png' for name in ['student-desktop','teacher-desktop','admin-desktop','public-knowledge-desktop'])
CURATED_SCREENSHOTS.update('docs/screenshots/review-v7/'+name+'.png' for name in ['02-assignment-change','04-stale-document','05-teacher-feedback','06-student-revision','07-reviewed-acceptance','public-catalogue','public-original-source'])
JSON_FILES.update({'docs/verification/review-v7.json','docs/verification/ai-review-pack-v7.json'})
JSON_FILES.update({'docs/verification/review-v8.json','docs/verification/licenses-v8.json'})
FORBIDDEN = {'.log','.tsbuildinfo','.pem','.key','.p12','.pfx','.jks','.keystore','.sqlite','.sqlite3','.db','.dump','.backup','.bak','.zip','.7z','.mp4','.webm','.onnx','.bin'}
excluded = []
redactions = []
files = []
replacements = {}
provider = re.compile(r'\b(?:sk-[A-Za-z0-9_-]{18,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b')
credential_name=r'[A-Za-z_]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)'
# A quoted property must have both quotes. A bare identifier cannot start
# inside a string such as 'AI_API_KEY=' + value + '\n'.
credential_field=f"""(?:"{credential_name}"|'{credential_name}'|(?<!["']){credential_name})"""
literal=re.compile(r'''(?i)((?<![\w-])'''+credential_field+r'''\s*[:=]\s*)(["'])([^"'\r\n]+)(\2)''')
safe_fixture = re.compile(r'(?i)^(?:test(?:ing)?(?:[-_ ].*)?|fixture(?:[-_ ].*)?|synthetic[-_].*|controlled[-_].*|review[-_].*|<[^>]+>|change_me.*|your[-_].*|not[-_]a[-_]real.*|example.*)$')
db_url = re.compile(r'postgres(?:ql)?://[^\s\"\'`<>]+')
private_block = re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----')
local_user_path = re.compile(r'(?i)[A-Z]:[\\/]+Users[\\/]+[^\\/\s\"\'`<>]+')

def skip(path, reason):
    # Excluded names can themselves contain personal identifiers. Keep a local
    # reproducible digest and broad category, never those names in the ZIP.
    first=path.split('/')[0]
    category=first if first in {'apps','scripts','docs','evaluation','packages','node_modules','.git','.runtime','output','tmp'} else 'unclassified'
    excluded.append({'category':category,'pathSha256':hashlib.sha256(path.encode('utf-8')).hexdigest(),'reason':reason})

def replacement(value):
    if value not in replacements:
        # Preserve the length of intentionally invalid short-input tests, not
        # their content. Longer credentials get an explicit review placeholder.
        replacements[value] = 'X'*len(value) if len(value)<8 else 'REVIEW_PLACEHOLDER_' + uuid.uuid4().hex[:20]
    return replacements[value]

def sanitize(text, relative):
    counts = Counter()
    def replace(pattern, value, rule):
        nonlocal text
        text, count = pattern.subn(value, text)
        if count: counts[rule] += count
    if relative.endswith('.env.example'):
        replace(re.compile(r'(?m)^(\s*(?:export\s+)?[A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=).*$',re.I),r'\1','empty_template_credentials')
        replace(re.compile(r'(?m)^DATABASE_URL=.*$'),'DATABASE_URL=postgresql://review_user:REVIEW_LOCAL_PASSWORD@127.0.0.1:5432/gongxu_review','template_database_placeholder')
    if relative == 'compose.yaml':
        for field,value in [('POSTGRES_PASSWORD','REVIEW_LOCAL_PASSWORD'),('POSTGRES_USER','review_user'),('POSTGRES_DB','gongxu_review')]:
            replace(re.compile(r'(?m)^(\s*'+field+r':).*$'),lambda match:match[1]+' '+value,'compose_local_placeholder')
    replace(private_block,'<REDACTED_PRIVATE_KEY>','private_key')
    replace(provider,lambda match:replacement(match[0]),'provider_token')
    def credential(match):
        value=match[3]
        if safe_fixture.fullmatch(value): return match[0]
        counts['credential_literal'] += 1
        return match[1]+match[2]+replacement(value)+match[4]
    text=literal.sub(credential,text)
    def database(match):
        url=match[0]
        # URLs with no userinfo are not credentials. Keep legitimate protocol tests.
        if '@' not in url:return url
        counts['database_url'] += 1
        return 'postgresql://review_user:REVIEW_LOCAL_PASSWORD@127.0.0.1:5432/gongxu_review'
    text=db_url.sub(database,text)
    replace(local_user_path,'C:/Users/<LOCAL_USER>','local_user_path')
    if counts:redactions.append({'path':relative,'rules':dict(counts)})
    return text

def png_without_metadata(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n':raise ValueError('Invalid PNG')
    output=bytearray(data[:8]);offset=8;removed=False
    while offset < len(data):
        size=int.from_bytes(data[offset:offset+4],'big');end=offset+12+size
        if end>len(data):raise ValueError('Invalid PNG length')
        kind=data[offset+4:offset+8]
        if kind not in {b'tEXt',b'zTXt',b'iTXt',b'eXIf',b'tIME'}:output.extend(data[offset:end])
        else:removed=True
        offset=end
    return bytes(output),removed

def clean_pdf_fixture(data):
    try:import pypdf
    except ImportError:
        for candidate in (ROOT.parent/'.review-export').glob('*/pdf-tools'):
            if (candidate/'pypdf').is_dir():sys.path.insert(0,str(candidate));break
        import pypdf
    reader=pypdf.PdfReader(BytesIO(data))
    expected='Software engineering requirements'
    if len(reader.pages)!=1 or reader.pages[0].extract_text().strip()!=expected:raise ValueError('Unrecognized PDF fixture; excluded for review')
    writer=pypdf.PdfWriter();writer.add_page(reader.pages[0]);writer.metadata=None
    output=BytesIO();writer.write(output)
    assert pypdf.PdfReader(BytesIO(output.getvalue())).pages[0].extract_text().strip()==expected
    return output.getvalue()

def candidate(relative):
    parts=Path(relative).parts
    if len(parts)==1:return relative in ROOT_FILES
    if parts[0] not in {'apps','scripts','docs','evaluation','packages','knowledge'}:return False
    if parts[0]=='knowledge':return len(parts)==3 and parts[1]=='teaching-v6' and Path(relative).suffix=='.mjs'
    if parts[0]=='docs':
        if relative in {'docs/verification/review-v8.json','docs/verification/licenses-v8.json'}:return True
        if relative in {'docs/verification/review-v7.json','docs/verification/ai-review-pack-v7.json','docs/verification/review-v5.json','docs/verification/review-v6.json','docs/verification/knowledge-v6.json'}:return True
        return (len(parts)==2 and parts[1] in DOCS) or relative in CURATED_SCREENSHOTS or relative in {'docs/verification/review-v2.json','docs/verification/review-v3.json','docs/verification/review-v4.json','docs/verification/ai-evaluation-v4.json','docs/demo-v3/README.md','docs/demo-v3/storyboard.json','docs/demo-v4/README.md','docs/demo-v4/storyboard.json'}
    return True

STAGE.mkdir(parents=True,exist_ok=False)
for current, directories, names in os.walk(ROOT,followlinks=False):
    parent=Path(current)
    for name in list(directories):
        path=parent/name;relative=path.relative_to(ROOT).as_posix()
        if name in SKIP_DIRS or path.is_symlink() or not path.resolve().is_relative_to(ROOT) or (parent==ROOT and name not in {'apps','scripts','docs','evaluation','packages','knowledge'}):
            directories.remove(name);skip(relative+'/', 'dependencies_generated_data_or_unreviewed_directory')
    for name in sorted(names):
        source=parent/name;relative=source.relative_to(ROOT).as_posix()
        if source.is_symlink() or not source.resolve().is_relative_to(ROOT):skip(relative,'symlink_or_outside_root_not_followed');continue
        if '.env' in name and not name.endswith('.env.example'):skip(relative,'real_environment_never_opened');continue
        if source.suffix.lower() in FORBIDDEN:skip(relative,'generated_or_sensitive_file_type');continue
        if source.suffix.lower() in {'.json','.yaml','.yml','.txt'} and re.search(r'(?i)(credential|secret|cookie|auth[-_]?state|session|token|account[-_]?export)',name):skip(relative,'possible_credentials_never_opened');continue
        if source.suffix.lower()=='.json' and relative not in JSON_FILES and not re.fullmatch(r'apps/[^/]+/(?:package|tsconfig(?:\.test)?)\.json',relative):skip(relative,'unclassified_json_or_possible_business_data');continue
        if source.suffix.lower()=='.txt' and not (re.fullmatch(r'scripts/requirements[-\w]*\.txt',relative) or re.search(r'(?i)(license|licence|notice|copying)',name)):skip(relative,'unclassified_plain_text_or_possible_business_data');continue
        if source.suffix.lower() in {'.yaml','.yml','.toml'} and relative not in ROOT_FILES:skip(relative,'unreviewed_config_or_possible_business_data');continue
        if source.suffix.lower()=='.sql' and not re.fullmatch(r'apps/api/migrations/[\w-]+\.sql',relative):skip(relative,'unreviewed_sql_or_possible_data_dump');continue
        if not candidate(relative):skip(relative,'outside_review_allowlist_or_uncertain_historical_material');continue
        destination=STAGE/relative;destination.parent.mkdir(parents=True,exist_ok=True)
        if source.suffix.lower() in TEXT or name in ROOT_FILES or name.upper() in {'LICENSE','LICENCE','NOTICE','COPYING','AUTHORS'} or name.endswith('.env.example'):
            try:text=source.read_text(encoding='utf-8-sig')
            except UnicodeError:skip(relative,'unknown_text_encoding');continue
            text=sanitize(text,relative)
            # Ordinary source is scanned, not executed. Public third-party notices keep attribution.
            if source.suffix=='.md' and 'THIRD' not in name.upper() and 'LICENSE' not in name.upper() and re.search(r'[\w.+-]+@(?!example\.(?:test|com|org|invalid)\b)[\w.-]+\.[A-Za-z]{2,}',text):
                skip(relative,'unclassified_email_in_document');continue
            destination.write_text(text,encoding='utf-8',newline='\n')
        elif relative=='apps/api/test-data/minimal.pdf':
            destination.write_bytes(clean_pdf_fixture(source.read_bytes()));redactions.append({'path':relative,'rules':{'pdf_metadata_removed':1}})
        elif source.suffix.lower()=='.png' and (relative=='apps/web/src/components/art/nebula-cache.png' or relative in CURATED_SCREENSHOTS):
            data,removed=png_without_metadata(source.read_bytes());destination.write_bytes(data)
            if removed:redactions.append({'path':relative,'rules':{'png_metadata_removed':1}})
        elif source.suffix.lower() in {'.woff','.woff2','.ico'} and relative.startswith('apps/web/'):
            destination.write_bytes(source.read_bytes())
        else:skip(relative,'unclassified_binary_or_file_type');continue
        files.append({'path':relative,'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()})

# Replace repeated occurrences of a discovered nontrivial credential, including
# references in assertions. This pass reads only staged copies, never real .env.
for entry in files:
    path=STAGE/entry['path']
    if path.suffix.lower() not in TEXT and not path.name.endswith('.env.example'):continue
    text=path.read_text(encoding='utf-8');count=0
    for value,placeholder in sorted(replacements.items(),key=lambda item:len(item[0]),reverse=True):
        if len(value)<8:continue
        occurrences=text.count(value)
        if occurrences:text=text.replace(value,placeholder);count+=occurrences
    if count:
        path.write_text(text,encoding='utf-8',newline='\n');redactions.append({'path':entry['path'],'rules':{'known_credential_occurrence':count}})
        entry['bytes']=path.stat().st_size;entry['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()

# Remove links to deliberately excluded historical documentation, in the copy only.
for entry in files:
    path=STAGE/entry['path']
    if path.suffix.lower()!='.md':continue
    text=path.read_text(encoding='utf-8')
    def local_link(match):
        label,target=match[1],match[2]
        if '://' in target or target.startswith('#') or target.startswith('mailto:'):return match[0]
        candidate_path=(path.parent/target.split('#')[0]).resolve()
        if candidate_path.is_relative_to(STAGE) and candidate_path.exists():return match[0]
        return label+'（历史或独立材料未纳入此源码包，见排除清单）'
    text,count=re.subn(r'!?\[([^\]\n]+)\]\(([^)\n]+)\)',local_link,text)
    path.write_text(text,encoding='utf-8',newline='\n')
    entry['bytes']=path.stat().st_size;entry['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()

# A second scan of the sanitized copy; no comparison against real environment secrets.
for entry in files:
    path=STAGE/entry['path']
    if path.suffix.lower() in TEXT or path.name.endswith('.env.example'):
        text=path.read_text(encoding='utf-8')
        if provider.search(text) or private_block.search(text):raise RuntimeError('Sensitive pattern remains in sanitized copy; no value printed')

manifest={'createdAt':datetime.now(timezone.utc).isoformat(),'scope':'sanitized_source_review_not_contest_submission','originalProjectModified':False,'realEnvironmentRead':False,'files':files,'excluded':excluded,'redactions':redactions,'limitations':['Pattern scanning cannot prove absence of every unknown secret.','Historical screenshots and reports were excluded unless explicitly generated from this round synthetic data.','Runtime models and dependencies must be installed separately.','Compose credentials are review-only local placeholders.']}
(STAGE/'SOURCE-PACKAGE-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
archive=EXPORT/('gongxu-zhiban-review-'+args.version+'.zip')
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=9) as bundle:
    for path in sorted(STAGE.rglob('*')):
        if path.is_file():bundle.write(path,'gongxu-zhiban/'+path.relative_to(STAGE).as_posix())
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert all('..' not in Path(name).parts and not name.startswith('/') for name in bundle.namelist())
    count=len(bundle.infolist())
(EXPORT/'export-summary.json').write_text(json.dumps({'archive':str(archive),'stage':str(STAGE),'files':count,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'excludedCount':len(excluded),'redactedFiles':redactions},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'archive':str(archive),'stage':str(STAGE),'files':count,'bytes':archive.stat().st_size,'excludedCount':len(excluded),'redactedFileCount':len({row['path'] for row in redactions})},ensure_ascii=False))
