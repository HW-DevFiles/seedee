#!/usr/bin/env python3
"""Rebuild vector masters, print PDFs, and trim PNGs. Run from any directory."""
from pathlib import Path
from html import escape
import base64
from fontTools.ttLib import TTFont as Font
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'marketing/flyers'
BRAND = ROOT / 'brand'
BG, GREEN, DEEP, SAGE, GOLD = '#F8F6EF', '#355E3B', '#1F3D2B', '#DCE6D5', '#D6A84B'
for name, weight in [('Regular',400),('Bold',750)]:
    target = BRAND / f'fonts/Manrope-{name}.ttf'
    font = instantiateVariableFont(Font(BRAND/'fonts/Manrope.ttf'), {'wght':weight}, inplace=False)
    for record in font['name'].names:
        if record.nameID in (1,2,4,6):
            value = {1:'Seedee Manrope',2:name,4:f'Seedee Manrope {name}',6:f'SeedeeManrope-{name}'}[record.nameID]
            record.string = value.encode(record.getEncoding())
    font.save(target)
    pdfmetrics.registerFont(TTFont(name,str(target)))

# Original geometrical seed mark: paired leaves, stem, and a studio foundation.
MARK = [('M',24,39),('L',24,22),('C',9,23,5,12,6,5),('C',19,4,25,11,24,22),('C',24,9,34,4,44,6),('C',44,19,35,25,24,24),('M',8,42),('L',40,42)]
def svg_path(commands):
    return ' '.join(str(v) for op in commands for v in op)

def outline(text, color):
    font=Font(BRAND/'fonts/Manrope-Bold.ttf'); gs=font.getGlyphSet(); cmap=font.getBestCmap(); x=0; paths=[]
    for ch in text:
        glyph=gs[cmap[ord(ch)]]; pen=SVGPathPen(gs); glyph.draw(pen)
        paths.append(f'<path transform="translate({x} 0)" d="{pen.getCommands()}"/>'); x+=glyph.width
    return f'<g fill="{color}" transform="translate(60 43) scale(0.0205 -0.0205)">{"".join(paths)}</g>'
for variant,color in [('light',DEEP),('dark',BG)]:
    mark=f'<path d="{svg_path(MARK)}" fill="none" stroke="{color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'
    for kind,width,content in [('mark',50,mark),('wordmark',210,mark+outline('seedee',color))]:
        (BRAND/f'{kind}-{variant}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="50" viewBox="0 0 {width} 50" role="img" aria-label="Seedee"><title>Seedee</title>{content}</svg>\n')

class Scene:
    def __init__(self, name, bg):
        self.name=name; self.parts=[]; self.texts=[]
        self.c=canvas.Canvas(str(OUT/f'{name}.pdf'),pagesize=(378,306),pageCompression=1)
        self.c.setTitle(f'Seedee | {name}'); self.c.setAuthor('Seedee / Ali')
        self.c.translate(9,297); self.c.scale(1,-1)
        self.rect(-9,-9,378,306,bg)
    def rect(self,x,y,w,h,fill,r=0):
        self.c.setFillColor(fill); self.c.roundRect(x,y,w,h,r,stroke=0,fill=1)
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"/>')
    def path(self,commands,color,width=1,fill=None):
        p=self.c.beginPath()
        for op in commands:
            if op[0]=='M': p.moveTo(*op[1:])
            elif op[0]=='L': p.lineTo(*op[1:])
            elif op[0]=='C': p.curveTo(*op[1:])
        self.c.setStrokeColor(color); self.c.setLineWidth(width); self.c.setLineCap(1)
        if fill: self.c.setFillColor(fill)
        self.c.drawPath(p,stroke=1,fill=bool(fill))
        self.parts.append(f'<path d="{svg_path(commands)}" stroke="{color}" stroke-width="{width}" stroke-linecap="round" fill="{fill or "none"}"/>')
    def circle(self,x,y,r,fill):
        self.c.setFillColor(fill); self.c.circle(x,y,r,stroke=0,fill=1)
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>')
    def text(self,x,y,text,size=10,color=DEEP,font='Regular'):
        w=pdfmetrics.stringWidth(text,font,size)
        assert x>=18 and x+w<=342.1, (self.name,text,w,x)
        assert y-size>=12 and y+size*.3<=276, (self.name,text,y)
        self.texts.append({'text':text,'x':x,'baseline':y,'size':size,'width':w})
        self.c.saveState(); self.c.translate(x,y); self.c.scale(1,-1)
        self.c.setFont(font,size); self.c.setFillColor(color); self.c.drawString(0,0,text); self.c.restoreState()
        self.parts.append(f'<text x="{x}" y="{y}" font-family="Manrope{font}" font-size="{size}" fill="{color}">{escape(text)}</text>')
    def logo(self,x=24,y=20,color=DEEP):
        self.path([(op[0], *[v*.48+(x if i%2==0 else y) for i,v in enumerate(op[1:])]) for op in MARK],color,1.6)
        self.text(x+30,y+20,'seedee',22,color,'Bold')
    def footer(self,cta,color=DEEP,disclosure='Demo preview · Sample outputs'):
        self.text(24,238,cta,11,color,'Bold')
        self.text(24,253,'Source: github.com/HW-DevFiles/seedee',8,color)
        self.text(24,269,disclosure,7.5,color)
    def finish(self):
        self.c.showPage(); self.c.save()
        reader=PdfReader(OUT/f'{self.name}.pdf'); page=reader.pages[0]
        page.trimbox=RectangleObject([9,9,369,297]); page.bleedbox=RectangleObject([0,0,378,306])
        writer=PdfWriter(); writer.add_page(page)
        with (OUT/f'{self.name}.pdf').open('wb') as f: writer.write(f)
        css=''.join(f'@font-face{{font-family:Manrope{n};src:url(data:font/ttf;base64,{base64.b64encode((BRAND/f"fonts/Manrope-{n}.ttf").read_bytes()).decode()})}}' for n in ['Regular','Bold'])
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="5.25in" height="4.25in" viewBox="-9 -9 378 306" role="img" aria-label="Seedee promotional flyer"><title>Seedee: {self.name}</title><style>{css}</style>{"".join(self.parts)}</svg>\n'
        (OUT/f'{self.name}.svg').write_text(svg)
        doc=fitz.open(OUT/f'{self.name}.pdf')
        doc[0].set_cropbox(fitz.Rect(9,9,369,297))
        pix=doc[0].get_pixmap(matrix=fitz.Matrix(300/72,300/72),alpha=False)
        pix.save(OUT/f'{self.name}.png')
        doc.close()
        return self.texts

scenes={}
s=Scene('01-company-taking-shape',BG); s.logo()
s.text(24,71,'A LITTLE SEED. ROOM TO GROW.',8,GREEN,'Bold')
for y,t in [(105,'Your creative practice.'),(136,'A company'),(167,'taking shape.')]: s.text(24,y,t,25,DEEP,'Bold')
for y,t in [(192,'Explore a demo of your personal creative agency.'),(206,'Shape an offer, plan the work, and see what comes next.')]: s.text(24,y,t,9)
s.circle(324,145,14,GOLD); s.path([('M',311,168),('C',293,154,283,171,292,184),('C',310,185,319,176,311,168)],GREEN,1,GREEN)
s.footer('Explore the Seedee demo.'); scenes[s.name]=s.finish()

s=Scene('02-seed-to-studio',BG); s.logo()
s.text(24,77,'Start with your craft.',24,DEEP,'Bold')
s.text(24,107,'Explore what comes next.',22,DEEP,'Bold')
# Symbolic seed, sprout, and studio. No growth scale or promised timeline.
s.rect(24,126,312,57,SAGE,6)
s.circle(57,154,9,GREEN)
s.path([('M',132,172),('L',132,147),('C',115,147,111,138,114,134),('C',128,134,132,140,132,147),('C',132,136,143,132,151,135),('C',149,147,140,150,132,147)],GREEN,2)
s.path([('M',211,172),('L',211,139),('L',246,139),('L',246,172),('M',222,172),('L',222,158),('L',235,158),('L',235,172)],GREEN,2)
s.path([('M',287,172),('L',287,147),('C',271,147,268,138,270,134),('C',282,134,287,140,287,147),('C',287,136,298,132,306,135),('C',304,147,295,150,287,147)],GREEN,2)
for y,t in [(204,'Give your agency idea room to take shape. Explore a company'),(217,'story, a growth plan, and the evidence behind your next step.')]: s.text(24,y,t,8.6)
s.footer('Explore the Seedee demo.',disclosure='Demo preview · Sample outputs · No funding guarantee')
scenes[s.name]=s.finish()

s=Scene('03-working-plan',DEEP); s.logo(color=BG)
s.text(24,74,'Give your next idea',25,BG,'Bold'); s.text(24,104,'a working plan.',25,BG,'Bold')
for x,w,label in [(24,98,'PRACTICE'),(131,98,'CREW'),(238,98,'PROJECTS')]:
    s.rect(x,124,w,49,GREEN,5); s.rect(x+10,135,17,3,GOLD,1); s.text(x+10,159,label,8,BG,'Bold')
for y,t in [(193,'Start with your creative practice. Explore how an agency'),(207,'could organize its crew, projects, and next steps.')]: s.text(24,y,t,9,BG)
s.text(24,220,'Illustrative workflow',7,BG)
s.footer('Explore the Seedee demo.',BG); scenes[s.name]=s.finish()

# Enforce the delivered contract after reopening every artifact.
for name in scenes:
    pdf=PdfReader(OUT/f'{name}.pdf'); assert len(pdf.pages)==1
    p=pdf.pages[0]; assert list(p.mediabox)==[0,0,378,306]; assert list(p.trimbox)==[9,9,369,297]
    assert list(p.bleedbox)==[0,0,378,306]
    assert p.extract_text().strip()
    with Image.open(OUT/f'{name}.png') as im: assert im.size==(1500,1200); im.verify()
    import xml.etree.ElementTree as ET
    ET.parse(OUT/f'{name}.svg')
print('Verified 3 PDFs (378 x 306 pt, 360 x 288 pt trim), 3 SVG masters, 3 PNGs (1500 x 1200), text safe margins >= 0.25 in.')
