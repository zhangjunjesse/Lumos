#!/usr/bin/env python3
"""
B站视频字幕抓取工具
支持官方字幕 + AI自动生成字幕（需要登录Cookie）
"""

import requests
import json
import re
import sys
import os
import hashlib
import time
import urllib.parse
from typing import Optional, List, Dict


# ── WBI 签名 ──────────────────────────────────────────────
MIXIN_KEY_ENC_TAB = [
    46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,
    27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
    37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
    22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52
]

def get_wbi_keys(session: requests.Session) -> tuple:
    resp = session.get("https://api.bilibili.com/x/web-interface/nav")
    data = resp.json()["data"]["wbi_img"]
    img_key = data["img_url"].split("/")[-1].split(".")[0]
    sub_key = data["sub_url"].split("/")[-1].split(".")[0]
    return img_key, sub_key

def get_mixin_key(img_key: str, sub_key: str) -> str:
    raw = img_key + sub_key
    return "".join(raw[i] for i in MIXIN_KEY_ENC_TAB)[:32]

def sign_params(params: dict, mixin_key: str) -> dict:
    params = dict(params)
    params["wts"] = int(time.time())
    sorted_params = dict(sorted(params.items()))
    query = urllib.parse.urlencode(sorted_params)
    params["w_rid"] = hashlib.md5(f"{query}{mixin_key}".encode()).hexdigest()
    return params


# ── 核心功能 ──────────────────────────────────────────────
def make_session(sessdata: Optional[str] = None) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": "https://www.bilibili.com"
    })
    if sessdata:
        session.cookies.set("SESSDATA", sessdata)
    return session

def extract_bvid(url_or_id: str) -> Optional[str]:
    bv_match = re.search(r'BV[a-zA-Z0-9]+', url_or_id)
    return bv_match.group(0) if bv_match else None

def get_video_info(session: requests.Session, bvid: str) -> Dict:
    resp = session.get(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}")
    data = resp.json()
    if data['code'] != 0:
        raise Exception(f"获取视频信息失败: {data['message']}")
    return data['data']

def get_subtitle_list(session: requests.Session, bvid: str, cid: int) -> List[Dict]:
    """使用WBI签名API获取字幕列表（包含AI字幕）"""
    img_key, sub_key = get_wbi_keys(session)
    mixin_key = get_mixin_key(img_key, sub_key)
    params = sign_params({"bvid": bvid, "cid": cid}, mixin_key)

    resp = session.get("https://api.bilibili.com/x/player/wbi/v2", params=params)
    data = resp.json()

    if data['code'] != 0:
        raise Exception(f"获取字幕列表失败: {data['message']}")

    subtitle_info = data['data'].get('subtitle')
    if not subtitle_info or not subtitle_info.get('subtitles'):
        return []
    return subtitle_info['subtitles']

def download_subtitle(url: str) -> Dict:
    if url.startswith("//"):
        url = "https:" + url
    return requests.get(url).json()

def format_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def to_srt(json_data: Dict) -> str:
    lines = []
    for i, item in enumerate(json_data['body'], 1):
        lines += [str(i), f"{format_time(item['from'])} --> {format_time(item['to'])}", item['content'], ""]
    return "\n".join(lines)

def to_txt(json_data: Dict) -> str:
    return '\n'.join(item['content'] for item in json_data['body'])

def sanitize(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', '_', name)[:200]


# ── 主流程 ────────────────────────────────────────────────
def main(video_input: str, output_format: str = 'srt', lang: str = 'zh',
         output_dir: str = '.', sessdata: Optional[str] = None):

    bvid = extract_bvid(video_input)
    if not bvid:
        print("❌ 无法识别的视频ID或URL")
        return 1

    print(f"📹 BV号: {bvid}")

    session = make_session(sessdata)

    # 获取视频信息
    video_info = get_video_info(session, bvid)
    title = video_info['title']
    cid = video_info['cid']
    print(f"📝 标题: {title}")

    # 获取字幕列表
    subtitles = get_subtitle_list(session, bvid, cid)

    if not subtitles:
        if not sessdata:
            print("\n❌ 没有字幕。提示：AI自动字幕需要登录，请提供 --sessdata")
            print("   获取方式：浏览器登录B站 → F12 → Application → Cookies → SESSDATA")
        else:
            print("❌ 该视频没有可用字幕（包括AI字幕）")
        return 1

    print(f"\n✅ 可用字幕:")
    for sub in subtitles:
        ai_tag = " [AI]" if sub['lan'].startswith('ai-') else ""
        print(f"  - {sub['lan_doc']} ({sub['lan']}){ai_tag}")

    # 选择字幕：优先匹配语言，其次选AI字幕，最后选第一个
    target = None
    for sub in subtitles:
        if lang in sub['lan']:
            target = sub
            break
    if not target:
        target = subtitles[0]

    print(f"\n⬇️  下载: {target['lan_doc']} ({target['lan']})")
    subtitle_data = download_subtitle(target['subtitle_url'])

    # 转换格式
    if output_format == 'srt':
        content, ext = to_srt(subtitle_data), 'srt'
    elif output_format == 'txt':
        content, ext = to_txt(subtitle_data), 'txt'
    else:
        content, ext = json.dumps(subtitle_data, ensure_ascii=False, indent=2), 'json'

    # 保存
    os.makedirs(output_dir, exist_ok=True)
    filename = sanitize(f"{title}_{target['lan']}.{ext}")
    filepath = os.path.join(output_dir, filename)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"✅ 已保存: {filepath}")
    print(f"📊 字幕条数: {len(subtitle_data['body'])}")
    return 0


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='B站视频字幕抓取（支持AI字幕）')
    parser.add_argument('video', help='视频URL或BV号')
    parser.add_argument('-f', '--format', choices=['srt', 'txt', 'json'], default='srt')
    parser.add_argument('-l', '--lang', default='zh', help='字幕语言关键词 (默认: zh)')
    parser.add_argument('-o', '--output', default='.', help='输出目录')
    parser.add_argument('--sessdata', help='B站登录Cookie中的SESSDATA值（获取AI字幕必须）')

    args = parser.parse_args()

    # 也支持从环境变量读取
    sessdata = args.sessdata or os.environ.get('BILIBILI_SESSDATA')

    sys.exit(main(args.video, args.format, args.lang, args.output, sessdata))
