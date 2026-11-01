"""Check the PDF layout bounds and make contact sheets for mandatory visual review."""
from pathlib import Path
import argparse,hashlib,json
import pdfplumber
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--confirm-visual-review',action='store_true',help='Use only after inspecting every rendered page; this flag does not perform visual review.')
args=parser.parse_args()
PDF=ROOT/'output/pdf/gongxu-zhiban-technical-v4.pdf'
TMP=ROOT/'tmp/pdfs/v4'
reports=[]
with pdfplumber.open(PDF) as pdf:
 assert 1<=len(pdf.pages)<=30
 for i,page in enumerate(pdf.pages):
  text=page.extract_text() or ''
  assert '工序智伴' in text and '\ufffd' not in text
  outside=sum(1 for char in page.chars if char['x0']<42 or char['x1']>553 or char['top']<20 or char['bottom']>820)
  reports.append({'page':i+1,'textCharacters':len(text),'outsideSafeBounds':outside})
 assert all(not row['outsideSafeBounds'] for row in reports)
pages=sorted(TMP.glob('page-*.png'));assert len(pages)==len(reports)
for start in range(0,len(pages),4):
 sheet=Image.new('RGB',(1200,1700),'#ded9e5')
 for slot,path in enumerate(pages[start:start+4]):
  im=Image.open(path);im.thumbnail((580,805))
  x=10+(slot%2)*600;y=25+(slot//2)*850
  sheet.paste(im,(x,y));ImageDraw.Draw(sheet).text((x,y-18),path.stem,fill='black')
 sheet.save(TMP/f'sheet-{start//4+1}.png')
(TMP/'layout-check.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
if args.confirm_visual_review:
 manifest_path=PDF.parent/'technical-pdf-v4-manifest.json'
 manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
 manifest.update({'visualReview':'all_rendered_pages_inspected','sha256':hashlib.sha256(PDF.read_bytes()).hexdigest(),'layoutBounds':reports,'renderResolutionDpi':90})
 manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{len(reports)} pages rendered; no text outside safe bounds. Contact sheets need human/model visual inspection.')
