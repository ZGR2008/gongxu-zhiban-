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

ROOT = Path(__file__).resolve().parents[1]
STAMP = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
EXPORT = ROOT.parent / '.review-export' / ('v2-' + STAMP)
STAGE = EXPORT / 'gongxu-zhiban'
ROOT_FILES = {'.editorconfig','.gitattributes','.gitignore','compose.yaml','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','README.md'}
SKIP_DIRS = {'node_modules','.venv','venv','__pycache__','.git','.runtime','.models','models','.cache','.vite','.turbo','dist','build','coverage','uploads','storage','output','tmp','.setup','.vscode','.idea'}
DOCS = {'CONTEST-ACCEPTANCE-2026-11.md','OPTIMIZATION-PROGRESS.md','TRACEABILITY-AND-RECOVERY.md','FINAL-REVIEW-2026-11.md','STARTUP-AND-VERIFICATION.md','TECHNICAL-MATERIAL.md','DEMO-WALKTHROUGH.md','SOURCE-PACKAGE.md'}
TEXT = {'.ts','.tsx','.js','.mjs','.cjs','.json','.yaml','.yml','.md','.css','.html','.sql','.txt','.svg','.glsl','.ps1','.py','.sh','.toml'}
FORBIDDEN = {'.log','.tsbuildinfo','.pem','.key','.p12','.pfx','.jks','.keystore','.sqlite','.sqlite3','.db','.dump','.backup','.bak','.zip','.7z','.mp4','.webm','.onnx','.bin'}
excluded = []
redactions = []
files = []
replacements = {}
provider = re.compile(r'\b(?:sk-[A-Za-z0-9_-]{18,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b')
literal = re.compile(r'''(?i)(\b[A-Za-z_]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\s*[:=]\s*)(["'])([^"'\r\n]{9,})(\2)''')
safe_fixture = re.compile(r'(?i)^(?:test(?:ing)?(?:[-_ ].*)?|fixture(?:[-_ ].*)?|synthetic[-_].*|controlled[-_].*|review[-_].*|<[^>]+>|change_me.*|your[-_].*|not[-_]a[-_]real.*|example.*)$')
db_url = re.compile(r'postgres(?:ql)?://[^\s\"\'`<>]+')
private_block = re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----')
local_user_path = re.compile(r'(?i)[A-Z]:[\\/]+Users[\\/]+[^\\/\s\"\'`<>]+')

def skip(path, reason):
    excluded.append({'path':path,'reason':reason})

def replacement(value):
    if value not in replacements:
        replacements[value] = 'REVIEW_PLACEHOLDER_' + uuid.uuid4().hex[:20]
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
    if parts[0] not in {'apps','scripts','docs','evaluation','packages'}:return False
    if parts[0]=='docs':
        return (len(parts)==2 and parts[1] in DOCS) or relative.startswith('docs/screenshots/review-v2/') or relative=='docs/verification/review-v2.json'
    return True

STAGE.mkdir(parents=True,exist_ok=False)
for current, directories, names in os.walk(ROOT,followlinks=False):
    parent=Path(current)
    for name in list(directories):
        path=parent/name;relative=path.relative_to(ROOT).as_posix()
        if name in SKIP_DIRS or path.is_symlink() or (parent==ROOT and name not in {'apps','scripts','docs','evaluation','packages'}):
            directories.remove(name);skip(relative+'/', 'dependencies_generated_data_or_unreviewed_directory')
    for name in sorted(names):
        source=parent/name;relative=source.relative_to(ROOT).as_posix()
        if source.is_symlink():skip(relative,'symlink_not_followed');continue
        if '.env' in name and not name.endswith('.env.example'):skip(relative,'real_environment_never_opened');continue
        if source.suffix.lower() in FORBIDDEN:skip(relative,'generated_or_sensitive_file_type');continue
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
        elif source.suffix.lower()=='.png' and (relative.startswith('apps/web/src/components/art/') or relative.startswith('docs/screenshots/review-v2/')):
            data,removed=png_without_metadata(source.read_bytes());destination.write_bytes(data)
            if removed:redactions.append({'path':relative,'rules':{'png_metadata_removed':1}})
        elif source.suffix.lower() in {'.woff','.woff2','.ico'} and relative.startswith('apps/web/'):
            destination.write_bytes(source.read_bytes())
        else:skip(relative,'unclassified_binary_or_file_type');continue
        files.append({'path':relative,'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()})

# Remove links to deliberately excluded historical documentation, in the copy only.
for entry in files:
    path=STAGE/entry['path']
    if path.suffix.lower()!='.md':continue
    text=path.read_text(encoding='utf-8')
    def local_link(match):
        label,target=match[1],match[2]
        if '://' in target or target.startswith('#') or target.startswith('mailto:'):return match[0]
        candidate_path=(path.parent/target.split('#')[0]).resolve()
        if candidate_path.exists():return match[0]
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
archive=EXPORT/'gongxu-zhiban-review-v2.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=9) as bundle:
    for path in sorted(STAGE.rglob('*')):
        if path.is_file():bundle.write(path,'gongxu-zhiban/'+path.relative_to(STAGE).as_posix())
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert all('..' not in Path(name).parts and not name.startswith('/') for name in bundle.namelist())
    count=len(bundle.infolist())
(EXPORT/'export-summary.json').write_text(json.dumps({'archive':str(archive),'stage':str(STAGE),'files':count,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'excludedCount':len(excluded),'redactedFiles':redactions},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'archive':str(archive),'stage':str(STAGE),'files':count,'bytes':archive.stat().st_size,'excludedCount':len(excluded),'redactedFileCount':len(redactions)},ensure_ascii=False))
