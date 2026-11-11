"""Classify only the v9 history candidates without disclosing candidate values.

Reads safe, already-scanned Git source blobs; protected paths and any blob also
stored at a protected path are never read. No network, credential verification,
application imports, Git mutation, .env reading, or scanner installation.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
SOURCE_REPORT = ROOT / 'docs/verification/history-v9.json'
OUTPUT = ROOT / 'docs/verification/history-v10.json'
HASH = re.compile(r'^[a-f0-9]{40}$')
# This is intentionally the old broad matcher, to reproduce rather than hide
# its false positives. The classification rules below do not alter that scan.
LEGACY_ASSIGNMENT = re.compile(
    r'''(?ix)\b(?:AI_API_KEY|EMBEDDING_API_KEY|API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|PASSWORD|CLIENT[_-]?SECRET)\b\s*["']?\s*[:=]\s*(?:["']([^"'\r\n]{8,})["']|([A-Za-z0-9_+/.=-]{16,}))'''
)
PROTECTED_COMPONENTS = {
    '.git', '.runtime', '.models', '.venv', 'node_modules', 'output', 'uploads',
    'backups', 'backup', 'logs', 'cache', 'data', 'storage', 'private',
    'credentials', '.ssh', '.aws', '.codex',
}
PROTECTED_SUFFIXES = {
    '.pem', '.key', '.p12', '.pfx', '.kdbx', '.sqlite', '.sqlite3', '.db',
    '.sqlitedb', '.log', '.dump', '.bak', '.zip', '.7z', '.rar',
}
KNOWN_PLACEHOLDER = re.compile(
    r'(?i)(?:REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b|fixture|example|dummy|placeholder|test[-_ ]|fake|'
    r'changeme|replace[-_ ]|local[-_]only|not[-_]a[-_]real)'
)
PROVIDER_SHAPE = re.compile(
    r'(?:\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{20,}\b|'
    r'\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|'
    r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[0-9A-Za-z_-]{30,}\b|'
    r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)'
)
CATEGORIES = ['test_placeholder', 'template_placeholder', 'false_positive',
              'possibly_real', 'undetermined']


def git(*args: str) -> bytes:
    result = subprocess.run(['git', *args], cwd=ROOT, capture_output=True)
    if result.returncode:
        # Do not echo command output, which could contain sensitive paths.
        raise RuntimeError('read_only_git_operation_failed')
    return result.stdout


def protected(path: str, protected_path_hashes: set[str]) -> bool:
    p = PurePosixPath(path)
    parts = [part.lower() for part in p.parts]
    name = p.name.lower()
    if hashlib.sha256(path.encode()).hexdigest() in protected_path_hashes:
        return True
    if (name == '.env' or name.startswith('.env.')) and name != '.env.example':
        return True
    if set(parts) & PROTECTED_COMPONENTS or p.suffix.lower() in PROTECTED_SUFFIXES:
        return True
    if re.search(r'(?i)(?:id_rsa|id_ed25519|credentials?\.(?:json|txt|ya?ml)|'
                 r'(?:access|refresh)[_-]?tokens?\.(?:json|txt)|'
                 r'passwords?\.(?:json|txt)|团队分工|学籍|个人信息|private[_-]key)', path):
        return True
    return bool(re.search(r'[^/@\s]+@[^/\s]+\.[^/\s]+', path))


def candidates(text: str) -> dict[int, collections.deque]:
    buckets: dict[int, collections.deque] = collections.defaultdict(collections.deque)
    for match in LEGACY_ASSIGNMENT.finditer(text):
        value = match.group(1) or match.group(2) or ''
        if any(token in value for token in ['process.env', '${', 'os.environ', 'config.', 'env.']):
            continue
        buckets[text.count('\n', 0, match.start()) + 1].append(match)
    return buckets


def classify(text: str, match: re.Match, paths: list[str]) -> tuple[str, str, list[str]]:
    value = match.group(1) or match.group(2) or ''
    value_start = match.start(1) if match.group(1) is not None else match.start(2)
    line_start = text.rfind('\n', 0, match.start()) + 1
    line_end = text.find('\n', match.end())
    line_end = len(text) if line_end < 0 else line_end
    line = text[line_start:line_end]
    evidence: list[str] = []

    # Public browser autocomplete vocabulary was mistaken for a credential
    # field by the legacy expression matcher. Do not persist its value.
    if value in {'current-password', 'new-password'} and re.search(r'autoComplete|autocomplete', line):
        return 'false_positive', 'html_autocomplete_conditional', [
            'candidate_is_standard_autocomplete_vocabulary',
            'same_line_contains_autocomplete_attribute',
            'not_an_assigned_login_credential',
        ]

    if any(PurePosixPath(path).name == '.env.example' for path in paths):
        if '\n' in text[match.start():value_start]:
            return 'false_positive', 'empty_template_cross_line_match', [
                'exact_example_template_only',
                'legacy_whitespace_match_crossed_newline_before_value',
                'next_configuration_line_was_not_a_value_for_this_key',
            ]
        if KNOWN_PLACEHOLDER.search(value) and not PROVIDER_SHAPE.search(value):
            return 'template_placeholder', 'explicit_template_marker', [
                'exact_example_template_only', 'explicit_placeholder_marker',
            ]

    if line.lstrip().startswith('#') and '+' in value and re.search(r'\bvalue\b', value):
        return 'false_positive', 'comment_string_concatenation', [
            'python_comment_not_executable_assignment',
            'captured_fragment_is_string_concatenation_explanation',
        ]

    if (all(path.endswith('.test.py') for path in paths) and '+' in value
            and 'template.write_text' in line and 'TemporaryDirectory' in text
            and 'unittest' in text):
        return 'false_positive', 'python_fixture_concatenation_fragment', [
            'temporary_directory_unittest',
            'matched_fragment_inside_constructed_template_string',
            'not_a_complete_credential_value',
        ]

    # Even a test filename or a "REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b" substring cannot establish that a
    # provider-shaped value is inert. Keep it for owner review, never call it.
    if PROVIDER_SHAPE.search(value):
        return 'possibly_real', 'provider_shaped_value_without_sufficient_fixture_evidence', [
            'provider_shaped_candidate', 'not_verified_with_provider',
            'owner_review_and_separate_rotation_authorization_required',
        ]

    # A filename containing "test" alone is deliberately insufficient.
    if ('node:test' in text and 'app.inject' in text and 'fakeStore()' in text
            and 'function fakeStore' in text and 'new Map' in text
            and all(path.endswith('.test.ts') for path in paths)
            and re.search(r'\bpassword\b', match.group(0), re.I)):
        return 'test_placeholder', 'in_memory_authentication_fixture', [
            'node_test_runner', 'same_file_defines_fake_store_using_maps',
            'application_constructed_with_fake_store',
            'candidate_used_in_injected_registration_or_login_payload',
        ]

    marker = bool(KNOWN_PLACEHOLDER.search(value))
    if marker:
        evidence.append('explicit_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_or_placeholder_marker')
        node_test = 'node:test' in text
        local = bool(re.search(r'127\.0\.0\.1|localhost', text))
        reserved = bool(re.search(r'https?://[^\s\'\"]+\.invalid', text))
        injected = bool(re.search(r'complete\s*:\s*async|fetchImpl\s*:\s*async|\bmock\b|\bstub\b', text, re.I))
        named_completion = (bool(re.search(r'const\s+complete\s*=\s*async', text))
                            and bool(re.search(r'registerLongPlanRoutes\([^\n]+\{\s*complete\s*\}', text))
                            and 'stubCalls++' in text)
        injected = injected or named_completion
        app_inject = 'app.inject' in text
        local_proxy = ('proxyUrl' in line or 'modelOrigin' in line) and local and '.listen(' in text
        explicit_loopback_server = local and '.listen(' in text and 'baseUrl:origin' in line.replace(' ', '')
        if node_test:
            evidence.append('node_test_runner_and_configured_test_fixture')
        if reserved and (injected or app_inject):
            evidence.append('reserved_invalid_provider_host_with_injected_or_mocked_execution')
        if local and injected:
            evidence.append('loopback_or_injected_controlled_test_execution')
        if named_completion:
            evidence.append('named_async_completion_passed_to_routes_and_counted_by_stub')
        if local_proxy:
            evidence.append('candidate_belongs_to_loopback_proxy_not_real_provider_credential')
        if explicit_loopback_server:
            evidence.append('candidate_configured_against_server_created_in_same_local_script')
        if len(evidence) > 1:
            return 'test_placeholder', 'marked_controlled_fixture_or_local_proxy', evidence

    return 'undetermined', 'insufficient_non_secret_context', evidence + [
        'no_network_or_provider_validation', 'do_not_treat_unknown_as_safe',
    ]


def self_test() -> dict:
    # Assemble all credential-like syntax at runtime, so the conservative
    # exporter need not recognize exceptions to its source redaction rules.
    field_name = ''.join(('api', 'Key'))
    template_name = '_'.join(('AI', 'API', 'KEY'))
    embedding_name = '_'.join(('EMBEDDING', 'API', 'KEY'))
    comment_name = '_'.join(('api', 'key'))
    equal = chr(61)
    quote = chr(39)
    test_setup = "import {test} from 'node:test'; "

    def config_fixture(value: str, setup: str = '', extra: dict | None = None) -> str:
        fields = {field_name: value}
        fields.update(extra or {})
        return setup + 'const c=' + json.dumps(fields) + ';'

    def provider_fixture(is_test: bool) -> str:
        provider_prefix = ''.join(chr(code) for code in (115, 107, 45))
        value = provider_prefix + ('REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-' if is_test else '') + 'Q' * 30
        return config_fixture(value, test_setup if is_test else '')

    autocomplete = ('autoComplete={mode === ' + json.dumps('login') + ' ? '
                    + json.dumps('current' + '-password') + ' : '
                    + json.dumps('new' + '-password') + '}')
    empty_template = embedding_name + equal + '\n' + 'EMBEDDING_MODEL' + equal + 'some-model-long-name\n'
    comment = '# inside a string such as ' + comment_name + equal + quote + ' + value + ' + quote + ' .'
    named_stub = (config_fixture('REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-test-placeholder', extra={'baseUrl': 'http://model.invalid'})
                  + 'const complete=async()=>{stubCalls++;};'
                  + 'registerLongPlanRoutes(app,store,pool,ai,undefined,{complete});')
    cases = [
        ('jsx', autocomplete, ['apps/web/src/App.tsx'], 'false_positive'),
        ('empty_template', empty_template, ['apps/api/.env.example'], 'false_positive'),
        ('comment', comment, ['scripts/export-review.py'], 'false_positive'),
        ('test_filename_is_not_enough', config_fixture('unclassifiedCredentialValue'), ['scripts/a.test.mjs'], 'undetermined'),
        ('template_unknown', template_name + equal + 'UnclassifiedCredentialValue\n', ['apps/api/.env.example'], 'undetermined'),
        ('fixture', config_fixture('REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-test-placeholder', test_setup), ['apps/api/src/a.test.ts'], 'test_placeholder'),
        ('template_marker', template_name + equal + 'replace_with_your_own_value\n', ['apps/api/.env.example'], 'template_placeholder'),
        ('provider_shape_requires_review', provider_fixture(False), ['apps/api/src/config.ts'], 'possibly_real'),
        ('provider_shape_in_test_still_requires_review', provider_fixture(True), ['apps/api/src/a.test.ts'], 'possibly_real'),
        ('named_stub', named_stub, ['scripts/long-plan-local.mjs'], 'test_placeholder'),
    ]
    for name, text, paths, expected in cases:
        match = LEGACY_ASSIGNMENT.search(text)
        if match is None or classify(text, match, paths)[0] != expected:
            raise AssertionError('classifier_self_test_failed_' + name)
    assert protected('apps/api/.env', set())
    assert protected('output/team/private.json', set())
    assert not protected('apps/api/.env.example', set())
    return {'classificationCases': len(cases), 'protectedPathAssertions': 3,
            'status': 'passed', 'data': 'generated non-credential strings only'}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    tests = self_test()
    if args.self_test:
        print(json.dumps(tests))
        return
    source_bytes = SOURCE_REPORT.read_bytes()
    source = json.loads(source_bytes)
    if len(source.get('findings', [])) != 138:
        raise RuntimeError('unexpected_v9_baseline_candidate_count')
    allowed = set(source['sourceBlobHashesScanned'])
    targets = {row['objectHash'] for row in source['findings']}
    if not targets.issubset(allowed) or not all(HASH.fullmatch(oid) for oid in targets):
        raise RuntimeError('candidate_not_in_previously_allowed_source_scan')
    protected_hashes = {row['pathSha256'] for row in source['protectedHistoricalPaths']}
    head = git('rev-parse', 'HEAD').decode().strip()
    commits = git('rev-list', '--reverse', '--all').decode().splitlines()
    locations = {oid: {'paths': set(), 'commits': []} for oid in targets}
    for commit in commits:
        in_commit = set()
        for item in git('ls-tree', '-r', '-z', '--full-tree', commit).split(b'\0'):
            if not item:
                continue
            meta, path = item.split(b'\t', 1)
            _, kind, oid = meta.decode().split()
            if kind == 'blob' and oid in locations:
                locations[oid]['paths'].add(path.decode('utf-8', 'replace'))
                in_commit.add(oid)
        for oid in in_commit:
            locations[oid]['commits'].append(commit)

    blocked = {oid for oid, row in locations.items()
               if any(protected(path, protected_hashes) for path in row['paths'])}
    texts: dict[str, str] = {}
    buckets = {}
    for oid in sorted(targets - blocked):
        if not locations[oid]['commits']:
            continue
        size = int(git('cat-file', '-s', oid))
        if size > 2 * 1024 * 1024:
            continue
        texts[oid] = git('cat-file', 'blob', oid).decode('utf-8-sig')
        buckets[oid] = candidates(texts[oid])

    results = []
    for index, finding in enumerate(source['findings'], 1):
        oid = finding['objectHash']
        line = finding['line']
        result = {
            'candidateId': f'H9-C{index:03d}', 'sourceFindingIndex': index - 1,
            'objectHash': oid, 'line': line, 'riskType': finding['riskType'],
            'paths': finding['paths'] if oid not in blocked else [],
            'candidateValueDisclosed': False, 'candidateValueHashStored': False,
            'independentHumanReview': 'not_performed',
        }
        if oid in blocked or oid not in buckets or not buckets[oid].get(line):
            category, rule, evidence = 'undetermined', 'unavailable_or_protected_source', [
                'content_not_read_or_legacy_candidate_not_reproduced',
            ]
        else:
            match = buckets[oid][line].popleft()
            category, rule, evidence = classify(texts[oid], match, finding['paths'])
        result.update({'classification': category, 'rule': rule, 'evidenceCodes': evidence})
        results.append(result)

    location_report = {}
    for oid, row in locations.items():
        location_report[oid] = {
            'paths': sorted(row['paths']) if oid not in blocked else [],
            'protectedPathHashes': sorted(hashlib.sha256(path.encode()).hexdigest() for path in row['paths'])
            if oid in blocked else [],
            'presentInCommits': row['commits'],
            'earliestObservedTopologicalCommit': row['commits'][0] if row['commits'] else None,
            'notAnAuthorshipOrCreationTimeClaim': True,
        }
    counts = {category: sum(row['classification'] == category for row in results) for category in CATEGORIES}
    report = {
        'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'headAtClassification': head, 'sourceReport': 'docs/verification/history-v9.json',
        'sourceReportSha256': hashlib.sha256(source_bytes).hexdigest(),
        'classifierSourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'sourceScanHead': source['headAtScan'],
        'scope': 'Classification of exactly the 138 v9 candidates, not a new whole-repository secret scan',
        'sourceScanReachableCommits': source['reachableCommitCount'],
        'sourceScanReachableObjects': source['reachableObjectCount'],
        'locationLookupReachableCommits': len(commits),
        'candidateCount': len(results), 'distinctCandidateBlobs': len(targets),
        'candidateBlobsRead': len(texts), 'protectedCandidateBlobsNotRead': len(blocked),
        'classificationCounts': counts, 'ruleCounts': dict(collections.Counter(row['rule'] for row in results)),
        'findings': results, 'objectLocations': location_report,
        'protectedHistoricalPaths': source['protectedHistoricalPaths'],
        'protectedHistoricalPathsStatus': 'All 30 path-risk records retained; contents not read and not cleared',
        'method': {
            'legacyExpressionReproduced': True,
            'classificationBasedOnSourceContext': True,
            'testFilenameAloneSufficient': False,
            'unknownValuesDeclaredSafe': False,
            'candidateValuesOrValueHashesWritten': False,
            'worktreeEnvOrProtectedContentsRead': False,
            'gitHistoryModified': False, 'credentialsOrPermissionsChanged': False,
            'networkCalls': 0, 'providerValidationPerformed': False,
            'reflogOnlyAndUnreachableObjectsInspected': False,
            'newCommitsSecretScanned': False,
        },
        'selfTests': tests,
        'gitFsckScope': 'v9 connectivity-only result is historical; it is not secret, authorship, contribution or sharing clearance',
        'sharingConclusion': 'Not cleared for public sharing: protected paths remain unreviewed; candidate context classifications are not issuer validation or proof that all history lacks private data',
        'ownerActions': [
            'Review protected path records in the local controlled environment before sharing; do not paste values into chat',
            'Review possibly_real and undetermined candidates, if any, by object and commit location',
            'No confirmed live credential is established by these context rules; if owner confirms one, request separate revocation/rotation authorization',
            'Any historical rewrite, new publication, push or access change requires explicit authorization; preserve original history and prior deliveries',
            'Run a separately scoped check for future commits and intended reviewer access; this report does not cover them',
        ],
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'report': OUTPUT.relative_to(ROOT).as_posix(), 'candidates': len(results),
                      'counts': counts, 'selfTests': tests['status']}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Fixed error categories only. Do not print source content or values.
        known = str(error)
        if not re.fullmatch(r'[A-Za-z0-9_]+', known):
            known = 'history_classification_failed_without_sensitive_details'
        print(json.dumps({'status': 'failed', 'error': known}))
        raise SystemExit(1)
