"""默认主题:深灰蓝 + 天蓝 (slate_sky)。

在你的项目工作目录里放一个同名 styles.py 可以覆盖此默认。
rebuild_*.py 的写法:
    import sys; sys.path.insert(0, '<workdir>')  # 项目优先
    sys.path.insert(1, '<skill_root>')           # fallback
    from styles import *
"""
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

# ---- 主色体系 ----
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

SKY_50   = RGBColor(0xF0, 0xF9, 0xFF)
SKY_100  = RGBColor(0xE0, 0xF2, 0xFE)
SKY_200  = RGBColor(0xBA, 0xE6, 0xFD)
SKY_400  = RGBColor(0x38, 0xBD, 0xF8)
SKY_500  = RGBColor(0x0E, 0xA5, 0xE9)
SKY_600  = RGBColor(0x02, 0x84, 0xC7)
SKY_700  = RGBColor(0x03, 0x69, 0xA1)

# ---- 语义色 (风险 / 警告 / 正向) ----
ROSE_50  = RGBColor(0xFF, 0xF1, 0xF2)
ROSE_100 = RGBColor(0xFF, 0xE4, 0xE6)
ROSE_500 = RGBColor(0xF4, 0x3F, 0x5E)
ROSE_600 = RGBColor(0xE1, 0x1D, 0x48)
ROSE_700 = RGBColor(0xBE, 0x12, 0x3C)

AMBER_50  = RGBColor(0xFF, 0xFB, 0xEB)
AMBER_400 = RGBColor(0xFB, 0xBF, 0x24)
AMBER_600 = RGBColor(0xD9, 0x77, 0x06)

EMERALD_50  = RGBColor(0xEC, 0xFD, 0xF5)
EMERALD_500 = RGBColor(0x10, 0xB9, 0x81)
EMERALD_700 = RGBColor(0x04, 0x78, 0x57)

# ---- 字体 ----
FONT_CN = 'PingFang SC'
FONT_EN = 'Helvetica Neue'

# ---- 字阶 (pt) ----
FS_H1    = 26    # 页标题
FS_H2    = 22    # 卡内主标题
FS_H3    = 14    # 段落 / 副标题
FS_BODY  = 11    # 正文
FS_LABEL = 10    # 小标签
FS_CAP   = 9     # 来源 / 注脚
FS_NUM   = 24    # 数字强调

# ---- 形状 ----
SHAPE_CARD   = MSO_SHAPE.ROUNDED_RECTANGLE
SHAPE_TOPBAR = MSO_SHAPE.ROUND_2_SAME_RECTANGLE   # 上圆下直
SHAPE_RECT   = MSO_SHAPE.RECTANGLE

# ---- 间距 (inch) ----
MARGIN_X = 0.40
GAP      = 0.22

# ---- Slide size (16:9 widescreen) ----
SLIDE_W = 13.333
SLIDE_H = 7.5


def set_topbar_adj(shape, amount=25000):
    """把 shape 的 prstGeom adj 设成上圆下直的值。

    amount 范围 0..100000,越大圆角越大。
    """
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
    g1.set('name', 'adj1')
    g1.set('fmla', f'val {amount}')
    g2 = etree.SubElement(avLst, qn('a:gd'))
    g2.set('name', 'adj2')
    g2.set('fmla', 'val 0')
