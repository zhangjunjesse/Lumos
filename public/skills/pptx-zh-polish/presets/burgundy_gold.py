"""Preset: burgundy + gold (酒红 + 金箔)。高端品牌/奢品/投行。"""
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

WHITE     = RGBColor(0xFF, 0xFF, 0xFF)
# 暖中性 (Stone)
SLATE_50  = RGBColor(0xFA, 0xF9, 0xF7)
SLATE_100 = RGBColor(0xF5, 0xF3, 0xEE)
SLATE_200 = RGBColor(0xE7, 0xE2, 0xD7)
SLATE_300 = RGBColor(0xD2, 0xC9, 0xB4)
SLATE_400 = RGBColor(0xA8, 0x9C, 0x82)
SLATE_500 = RGBColor(0x78, 0x6E, 0x5A)
SLATE_600 = RGBColor(0x57, 0x4F, 0x40)
SLATE_700 = RGBColor(0x3E, 0x38, 0x2D)
SLATE_800 = RGBColor(0x2A, 0x25, 0x1C)
SLATE_900 = RGBColor(0x1A, 0x15, 0x0F)

# 主色 (Burgundy)
ACCENT_50  = RGBColor(0xFD, 0xF4, 0xF5)
ACCENT_100 = RGBColor(0xFB, 0xE4, 0xE7)
ACCENT_200 = RGBColor(0xF2, 0xB8, 0xC0)
ACCENT_400 = RGBColor(0xC8, 0x4A, 0x5C)
ACCENT_500 = RGBColor(0x95, 0x12, 0x33)
ACCENT_600 = RGBColor(0x7A, 0x0F, 0x29)
ACCENT_700 = RGBColor(0x5D, 0x1D, 0x2E)

# 金箔点缀
GOLD_400 = RGBColor(0xD4, 0xAF, 0x5A)
GOLD_500 = RGBColor(0xBF, 0x9A, 0x4A)
GOLD_600 = RGBColor(0x99, 0x77, 0x29)

# 兼容别名(让通用代码少改)
SKY_50, SKY_100, SKY_200 = ACCENT_50, ACCENT_100, ACCENT_200
SKY_400, SKY_500, SKY_600, SKY_700 = ACCENT_400, ACCENT_500, ACCENT_600, ACCENT_700

ROSE_50, ROSE_100 = RGBColor(0xFF, 0xF1, 0xF2), RGBColor(0xFF, 0xE4, 0xE6)
ROSE_500, ROSE_600, ROSE_700 = RGBColor(0xF4, 0x3F, 0x5E), RGBColor(0xE1, 0x1D, 0x48), RGBColor(0xBE, 0x12, 0x3C)
AMBER_50, AMBER_400, AMBER_600 = RGBColor(0xFF, 0xFB, 0xEB), GOLD_400, GOLD_600
EMERALD_50, EMERALD_500, EMERALD_700 = RGBColor(0xEC, 0xFD, 0xF5), RGBColor(0x10, 0xB9, 0x81), RGBColor(0x04, 0x78, 0x57)

FONT_CN = 'PingFang SC'
FONT_EN = 'Georgia'   # 衬线,配高端调性

FS_H1, FS_H2, FS_H3 = 28, 22, 14
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
