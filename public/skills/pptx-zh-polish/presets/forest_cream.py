"""Preset: forest + cream (森林绿 + 奶油)。ESG/健康/食品。"""
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

WHITE     = RGBColor(0xFF, 0xFF, 0xFF)
# 暖中性
SLATE_50  = RGBColor(0xFA, 0xF9, 0xF5)
SLATE_100 = RGBColor(0xF5, 0xF1, 0xE8)
SLATE_200 = RGBColor(0xE8, 0xE0, 0xCB)
SLATE_300 = RGBColor(0xC8, 0xBE, 0xA3)
SLATE_400 = RGBColor(0x96, 0x8E, 0x77)
SLATE_500 = RGBColor(0x6B, 0x65, 0x54)
SLATE_600 = RGBColor(0x4E, 0x4A, 0x3C)
SLATE_700 = RGBColor(0x39, 0x36, 0x2B)
SLATE_800 = RGBColor(0x25, 0x23, 0x1C)
SLATE_900 = RGBColor(0x17, 0x15, 0x11)

# 主色 (Forest)
ACCENT_50  = RGBColor(0xEF, 0xF5, 0xEE)
ACCENT_100 = RGBColor(0xD7, 0xE6, 0xD3)
ACCENT_200 = RGBColor(0xA8, 0xC9, 0xA0)
ACCENT_400 = RGBColor(0x6F, 0xA3, 0x68)
ACCENT_500 = RGBColor(0x40, 0x69, 0x5B)
ACCENT_600 = RGBColor(0x2E, 0x51, 0x45)
ACCENT_700 = RGBColor(0x1E, 0x35, 0x2C)

SKY_50, SKY_100, SKY_200 = ACCENT_50, ACCENT_100, ACCENT_200
SKY_400, SKY_500, SKY_600, SKY_700 = ACCENT_400, ACCENT_500, ACCENT_600, ACCENT_700

ROSE_50, ROSE_100 = RGBColor(0xFF, 0xF1, 0xF2), RGBColor(0xFF, 0xE4, 0xE6)
ROSE_500, ROSE_600, ROSE_700 = RGBColor(0xF4, 0x3F, 0x5E), RGBColor(0xE1, 0x1D, 0x48), RGBColor(0xBE, 0x12, 0x3C)
AMBER_50, AMBER_400, AMBER_600 = RGBColor(0xFF, 0xFB, 0xEB), RGBColor(0xE3, 0xB4, 0x48), RGBColor(0xA8, 0x82, 0x23)
EMERALD_50, EMERALD_500, EMERALD_700 = ACCENT_50, ACCENT_500, ACCENT_700

FONT_CN = 'PingFang SC'
FONT_EN = 'Helvetica Neue'

FS_H1, FS_H2, FS_H3 = 26, 22, 14
FS_BODY, FS_LABEL, FS_CAP, FS_NUM = 11, 10, 9, 24

SHAPE_CARD   = MSO_SHAPE.ROUNDED_RECTANGLE
SHAPE_TOPBAR = MSO_SHAPE.ROUND_2_SAME_RECTANGLE
SHAPE_RECT   = MSO_SHAPE.RECTANGLE

MARGIN_X, GAP = 0.40, 0.22
SLIDE_W, SLIDE_H = 13.333, 7.5


def set_topbar_adj(shape, amount=25000):
    from lxml import etree
    from pptx.oxml.ns import qn
    prstGeom = shape._element.find('.//' + qn('a:prstGeom'))
    if prstGeom is None:
        return
    avLst = prstGeom.find(qn('a:avLst'))
    if avLst is None:
        avLst = etree.SubElement(prstGeom, qn('a:avLst'))
    for g in list(avLst):
        avLst.remove(g)
    g1 = etree.SubElement(avLst, qn('a:gd'))
    g1.set('name', 'adj1'); g1.set('fmla', f'val {amount}')
    g2 = etree.SubElement(avLst, qn('a:gd'))
    g2.set('name', 'adj2'); g2.set('fmla', 'val 0')
