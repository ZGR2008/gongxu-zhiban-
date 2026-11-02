"""Read local package metadata, vendored notices and font flags; never read .env.

No network, model calls or application imports. This is an evidence inventory,
not a legal opinion or a competition originality decision. Optional PDF
inspection needs pypdf from the documented material authoring environment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def font_tables(data: bytes, offset: int = 0) -> dict:
    tables = {}
    for index in range(struct.unpack_from('>H', data, offset + 4)[0]):
        tag, _, position, size = struct.unpack_from('>4sIII', data, offset + 12 + index * 16)
        tables[tag.decode('ascii')] = (position, size)
    return tables


def font_flags(path: Path) -> list:
    data = path.read_bytes()
    offsets = ([struct.unpack_from('>I', data, 12 + index * 4)[0]
                for index in range(struct.unpack_from('>I', data, 8)[0])]
               if data[:4] == b'ttcf' else [0])
    result = []
    for index, offset in enumerate(offsets):
        tables = font_tables(data, offset)
        flag = struct.unpack_from('>H', data, tables['OS/2'][0] + 8)[0]
        result.append({'fontIndex': index, 'fsType': flag,
                       'editableEmbeddingFlag': bool(flag & 8),
                       'restrictedFlag': bool(flag & 2),
                       'noSubsettingFlag': bool(flag & 256),
                       'bitmapOnlyFlag': bool(flag & 512)})
    return result


def inspect_pdf(path: Path) -> dict:
    from pypdf import PdfReader
    reader = PdfReader(path)
    fonts = {}
    for page in reader.pages:
        for reference in page['/Resources']['/Font'].get_object().values():
            font = reference.get_object()
            descriptor = font.get('/FontDescriptor')
            descriptor = descriptor.get_object() if descriptor else None
            if not descriptor or '/FontFile2' not in descriptor:
                continue
            data = descriptor['/FontFile2'].get_object().get_data()
            tables = font_tables(data)
            fonts[str(font.get('/BaseFont'))] = {
                'bytes': len(data),
                'fsType': struct.unpack_from('>H', data, tables['OS/2'][0] + 8)[0]
                if 'OS/2' in tables else None,
            }
    return {'file': path.name, 'sha256': digest(path), 'pages': len(reader.pages),
            'embeddedTrueTypeSubsets': fonts}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='docs/verification/licenses-v8.json')
    parser.add_argument('--font', default='C:/Windows/Fonts/msyh.ttc')
    parser.add_argument('--pdf', action='append', default=[])
    args = parser.parse_args()
    direct = []
    manifests = [ROOT / 'package.json', *sorted((ROOT / 'apps').glob('*/package.json'))]
    for manifest in manifests:
        data = json.loads(manifest.read_text(encoding='utf-8'))
        for kind in ['dependencies', 'devDependencies']:
            for name, declared in data.get(kind, {}).items():
                metadata = manifest.parent / 'node_modules' / name / 'package.json'
                package = json.loads(metadata.read_text(encoding='utf-8')) if metadata.exists() else {}
                notices = [{'file': file.name, 'sha256': digest(file)}
                           for file in (sorted(metadata.parent.iterdir()) if metadata.exists() else [])
                           if file.is_file() and any(word in file.name.lower()
                               for word in ['license', 'licence', 'notice', 'copying'])]
                direct.append({'workspace': data['name'], 'kind': kind, 'package': name,
                               'declared': declared, 'installedVersion': package.get('version'),
                               'licenseExpression': package.get('license'),
                               'installedNoticeFiles': notices,
                               'manifest': manifest.relative_to(ROOT).as_posix()})
    vendor = ROOT / 'apps/web/public/previews/vendor'
    manifest = json.loads((vendor / 'manifest.json').read_text(encoding='utf-8'))
    checks = [{'file': entry['file'], 'expectedSha256': entry['sha256'],
               'actualSha256': digest(vendor / entry['file']),
               'matches': digest(vendor / entry['file']) == entry['sha256']}
              for entry in manifest['files']]
    assets = []
    for directory in ['apps/web/src', 'apps/web/public']:
        for path in sorted((ROOT / directory).rglob('*')):
            if path.is_file() and path.suffix.lower() in {
                '.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff', '.woff2', '.ttf', '.ttc', '.otf', '.mp3', '.mp4'
            }:
                assets.append({'file': path.relative_to(ROOT).as_posix(),
                               'bytes': path.stat().st_size, 'sha256': digest(path)})
    notices = ['apps/web/public/THIRD-PARTY-LICENSES.txt',
               'apps/web/public/previews/vendor/NOTICE.txt',
               'apps/embedding/THIRD_PARTY_NOTICES.md']
    fonts = Path(args.font)
    result = {
        'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'scope': 'Local metadata and selected upstream primary sources; no legal or contest clearance',
        'secretsOrBusinessDataRead': False, 'networkCallsByScript': 0, 'paidModelCalls': 0,
        'lockfileSha256': digest(ROOT / 'pnpm-lock.yaml'),
        'directDeclarationCount': len(direct),
        'uniqueDirectPackages': len({row['package'] for row in direct}),
        'directLicenseCounts': dict(Counter(str(row['licenseExpression']) for row in direct)),
        'directDependencies': direct, 'vendorManifestChecks': checks,
        'assets': assets,
        'existingNotices': [{'file': name, 'sha256': digest(ROOT / name)} for name in notices],
        'documentFont': {'name': fonts.name, 'rawFontRedistributed': False,
                         'flags': font_flags(fonts) if fonts.exists() else [],
                         'limitation': 'Flags do not prove OS acquisition license or contest eligibility'},
        'pdfs': [inspect_pdf(Path(name)) for name in args.pdf],
        'upstreamSources': [
            {'url': 'https://www.boxuegu.com/matchTrack/detail/?id=10037',
             'observed': 'AI coding tools allowed with clear explanation of all code; team edition linkage still needs registration evidence',
             'localEvidence': '.runtime/compliance-v8-official/track-10037.txt',
             'evidenceSha256': 'd1e49e586ddc1729607cb273a2d5832f0a1deaa93f3660aedcb46762996babfd',
             'line': 456, 'publishedDate': None},
            {'url': 'https://github.com/adelmassimo/SaturnWebGL', 'observed': 'MIT repository; local full notice retained'},
            {'url': 'https://huggingface.co/BAAI/bge-small-zh-v1.5', 'observed': 'base model card declares MIT'},
            {'url': 'https://huggingface.co/Xenova/bge-small-zh-v1.5', 'observed': 'ONNX conversion links to BAAI; fixed revision card not retrieved'},
            {'url': 'https://learn.microsoft.com/en-us/typography/fonts/font-faq', 'observed': 'document embedding subject to font flags; raw font redistribution separate'},
            {'url': 'https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype', 'observed': 'fsType embedding definitions'},
        ],
        'unresolved': [
            'Current official page allows AI coding tools with code explanation requirement; team edition linkage, actual ability and specific disclosure still require evidence',
            'Independent student contribution records and teacher review not established by AI agent changes or Git authors',
            'Fixed ONNX conversion repository license evidence incomplete; do not redistribute model weights in source ZIP',
            'Full transitive binary/image distribution license assessment not performed; dependency directories excluded',
            'Copyright and originality of generated assets/text cannot be certified solely by local hashes',
        ],
    }
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'report': output.relative_to(ROOT).as_posix(),
                      'directDeclarations': len(direct), 'vendorHashesMatch': all(c['matches'] for c in checks),
                      'assets': len(assets), 'pdfs': len(result['pdfs'])}, ensure_ascii=False))


if __name__ == '__main__':
    main()
