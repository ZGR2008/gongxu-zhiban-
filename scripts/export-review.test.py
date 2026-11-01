"""Privacy regression of the source-copy exporter using synthetic files only."""
from pathlib import Path
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch
import ast,hashlib,json,runpy,sys,tempfile,unittest,zipfile

SCRIPT=Path(__file__).with_name('export-review.py')

class ExportTests(unittest.TestCase):
    def export(self,root,forbidden=()):
        read_text,read_bytes=Path.read_text,Path.read_bytes
        def guarded_text(path,*args,**kwargs):
            self.assertNotIn(path.resolve(),forbidden,'Excluded sensitive files must never be opened')
            return read_text(path,*args,**kwargs)
        def guarded_bytes(path,*args,**kwargs):
            self.assertNotIn(path.resolve(),forbidden,'Excluded sensitive files must never be opened')
            return read_bytes(path,*args,**kwargs)
        output=StringIO()
        with patch.object(sys,'argv',[str(SCRIPT),'--source',str(root)]),patch.object(Path,'read_text',guarded_text),patch.object(Path,'read_bytes',guarded_bytes),redirect_stdout(output):
            runpy.run_path(str(SCRIPT),run_name='__main__')
        return json.loads(output.getvalue())

    def fixture(self,base):
        root=Path(base)/'source';(root/'apps/api/src').mkdir(parents=True)
        (root/'apps/api/package.json').write_text('{"name":"synthetic-export"}',encoding='utf-8')
        return root

    def test_sanitizes_quoted_and_short_credentials_only_in_copy(self):
        with tempfile.TemporaryDirectory(prefix='gongxu-export-fixture-') as base:
            root=self.fixture(base)
            opaque='73be150c-1473-427f-95d2-73e961be4100'
            provider='sk-'+'A'*24
            original=json.dumps({'apiKey':opaque,'password':'tiny','token':'controlled-fixture'})
            ui="const autoComplete = login ? 'current-password' : 'new-password';"
            source=root/'apps/api/src/config.ts';source.write_text('export const config = '+original+f'; const provider = "{provider}"; const backup = "{opaque}";'+ui,encoding='utf-8')
            template=root/'apps/api/.env.example';template.write_text('AI_API_KEY='+opaque+'\nDATABASE_URL=postgresql://fixture:fixture@localhost/review\n',encoding='utf-8')
            before={path:hashlib.sha256(path.read_bytes()).hexdigest() for path in [source,template]}
            result=self.export(root);stage=Path(result['stage']);copied=(stage/'apps/api/src/config.ts').read_text(encoding='utf-8')
            self.assertTrue(all(value not in copied for value in [opaque,provider,'tiny']))
            self.assertIn('XXXX',copied);self.assertIn('controlled-fixture',copied);self.assertIn('REVIEW_PLACEHOLDER_',copied)
            self.assertIn(ui,copied,'An autocomplete UI string must not be mistaken for a credential assignment')
            self.assertIn('AI_API_KEY=\n',(stage/'apps/api/.env.example').read_text(encoding='utf-8'))
            self.assertEqual(before,{path:hashlib.sha256(path.read_bytes()).hexdigest() for path in before})
            with zipfile.ZipFile(result['archive']) as bundle:
                self.assertIsNone(bundle.testzip());self.assertTrue(all(name.startswith('gongxu-zhiban/') and '..' not in Path(name).parts for name in bundle.namelist()))

    def test_environment_unknown_data_and_unreviewed_media_are_excluded_before_read(self):
        with tempfile.TemporaryDirectory(prefix='gongxu-export-fixture-') as base:
            root=self.fixture(base);forbidden=[]
            for relative in ['apps/api/.env','apps/api/.env.local','apps/api/auth-state.json','apps/api/records.json','apps/api/student-list.txt','apps/api/users.sql','apps/api/customer-data.yaml','docs/screenshots/review-v3/private.png']:
                path=root/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('synthetic-private-marker',encoding='utf-8');forbidden.append(path.resolve())
            result=self.export(root,forbidden);manifest=json.loads((Path(result['stage'])/'SOURCE-PACKAGE-MANIFEST.json').read_text(encoding='utf-8'))
            self.assertEqual(len(manifest['files']),1);self.assertFalse(manifest['realEnvironmentRead']);self.assertEqual(len(manifest['excluded']),8)
            with zipfile.ZipFile(result['archive']) as bundle:self.assertFalse(any('private-marker' in bundle.read(item).decode('utf-8') for item in bundle.namelist()))

    def test_repeated_exports_preserve_existing_archive_and_keep_current_documents(self):
        with tempfile.TemporaryDirectory(prefix='gongxu-export-fixture-') as base:
            root=self.fixture(base);(root/'docs').mkdir();(root/'evaluation').mkdir()
            (root/'docs/CONTINUATION-2026-11-01.md').write_text('Synthetic progress',encoding='utf-8')
            (root/'evaluation/record-template.json').write_text('{"status":"not_executed"}',encoding='utf-8')
            first=self.export(root);original=Path(first['archive']).read_bytes();second=self.export(root)
            self.assertNotEqual(first['archive'],second['archive']);self.assertEqual(Path(first['archive']).read_bytes(),original)
            with zipfile.ZipFile(second['archive']) as bundle:
                self.assertIn('gongxu-zhiban/docs/CONTINUATION-2026-11-01.md',bundle.namelist());self.assertIn('gongxu-zhiban/evaluation/record-template.json',bundle.namelist())

    def test_directory_resolving_outside_source_is_pruned_without_reading(self):
        with tempfile.TemporaryDirectory(prefix='gongxu-export-fixture-') as base:
            root=self.fixture(base);link=root/'apps/api/linked';link.mkdir();hidden=link/'outside.ts';hidden.write_text('synthetic-private-marker',encoding='utf-8')
            resolve=Path.resolve;outside=Path(base)/'outside';blocked=hidden.resolve()
            def redirected(path,*args,**kwargs):
                actual=resolve(path,*args,**kwargs)
                return outside/actual.relative_to(link) if actual.is_relative_to(link) else actual
            # Simulate a directory junction even on systems that cannot create one.
            with patch.object(Path,'resolve',redirected):result=self.export(root,(blocked,outside/'outside.ts'))
            with zipfile.ZipFile(result['archive']) as bundle:self.assertFalse(any('outside.ts' in item for item in bundle.namelist()))

    def test_string_concatenation_and_tool_source_remain_valid_python(self):
        with tempfile.TemporaryDirectory(prefix='gongxu-export-fixture-') as base:
            root=self.fixture(base);(root/'scripts').mkdir()
            sample="value='synthetic-fixture'\ntext='AI_API_KEY='+value+'\\n'\nui='current-password' if True else 'new-password'\n"
            (root/'scripts/sample.py').write_text(sample,encoding='utf-8')
            (root/'scripts/export-review.py').write_text(SCRIPT.read_text(encoding='utf-8'),encoding='utf-8')
            result=self.export(root);stage=Path(result['stage'])
            self.assertEqual((stage/'scripts/sample.py').read_text(encoding='utf-8'),sample)
            ast.parse((stage/'scripts/export-review.py').read_text(encoding='utf-8'))

    def test_excluded_personal_filenames_are_not_disclosed_in_the_packaged_manifest(self):
        with tempfile.TemporaryDirectory(prefix='gongxu-export-fixture-') as base:
            root=self.fixture(base);(root/'docs').mkdir()
            private_name='synthetic-student-at-private-school-notes.md'
            source=root/'docs'/private_name;source.write_text('synthetic-private-content',encoding='utf-8')
            before=hashlib.sha256(source.read_bytes()).hexdigest()
            result=self.export(root,(source.resolve(),))
            with zipfile.ZipFile(result['archive']) as bundle:
                self.assertFalse(any(private_name in name or private_name.encode() in bundle.read(name) for name in bundle.namelist()))
                manifest=json.loads(bundle.read('gongxu-zhiban/SOURCE-PACKAGE-MANIFEST.json'))
                self.assertEqual(manifest['excluded'][0]['category'],'docs')
                self.assertEqual(manifest['excluded'][0]['pathSha256'],hashlib.sha256(('docs/'+private_name).encode()).hexdigest())
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)

if __name__=='__main__':unittest.main()
