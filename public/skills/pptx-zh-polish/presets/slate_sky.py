"""Preset: slate + sky (深灰蓝 + 天蓝)。科技/安全/金融。

用法: 拷贝到工作目录改名 styles.py 即可。
"""
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

WHITE     = RGBColor(0xFF, 0xFF, 0xFF)
SLATE_50  = RGBColor(0xF8, 0xFA, 0xFC)
SLATE_100 = RGBColor(0xF1, 0xF5, 0xF9)
SLATE_200 = RGBColor(0xE2, 0xE8, 0xF0)
SLATE_300 = RGBColor(0xCB, 0xD5, 0xE1)
SLATE_400 = RGBColor(0x94, 0xA3, 0xB8)
SLATE_500 = RGBColor(0x64, 0x74, 0x8B)
SLATE_600 = RGBColor(0x47, 0x55, 0x69)
SLATE_700 = RGBColor(0x33, 0x41, 0x55)
SLATE_800 = RGBColor(0x1E, 0x29, 0x3B)
SLATE_900 = RGBColor(0x0F, 0x17, 0x2A)

# 主色(Sky)
ACCENT_50  = RGBColor(0xF0, 0xF9, 0xFF)
ACCENT_100 = RGBColor(0xE0, 0xF2, 0xFE)
ACCENT_200 = RGBColor(0xBA, 0xE6, 0xFD)
ACCENT_400 = RGBColor(0x38, 0xBD, 0xF8)
ACCENT_500 = RGBColor(0x0E, 0xA5, 0xE9)
ACCENT_600 = RGBColor(0x02, 0x84, 0xC7)
ACCENT_700 = RGBColor(0x03, 0x69, 0xA1)

# 兼容别名
SKY_50, SKY_100, SKY_200 = ACCENT_50, ACCENT_100, ACCENT_200
SKY_400, SKY_500, SKY_600, SKY_700 = ACCENT_400, ACCENT_500, ACCENT_600, ACCENT_700

# 语义色
ROSE_50, ROSE_100 = RGBColor(0xFF, 0xF1, 0xF2), RGBColor(0xFF, 0xE4, 0xE6)
ROSE_500, ROSE_600, ROSE_700 = RGBColor(0xF4, 0x3F, 0x5E), RGBColor(0xE1, 0x1D, 0x48), RGBColor(0xBE, 0x12, 0x3C)
AMBER_50, AMBER_400, AMBER_600 = RGBColor(0xFF, 0xFB, 0xEB), RGBColor(0xFB, 0xBF, 0x24), RGBColor(0xD9, 0x77, 0x06)
EMERALD_50, EMERALD_500, EMERALD_700 = RGBColor(0xEC, 0xFD, 0xF5), RGBColor(0x10, 0xB9, 0x81), RGBColor(0x04, 0x78, 0x57)

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
