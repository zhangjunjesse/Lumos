#!/usr/bin/env python3
"""
B站视频搜索工具
支持关键词搜索和UP主视频搜索
"""

import requests
import sys
import os
import hashlib
import time
import urllib.parse
from typing import Optional

MIXIN_KEY_ENC_TAB = [
    46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,
    27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
    37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
    22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52
]

def make_session(sessdata: Optional[str] = None) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": "https://www.bilibili.com"
    })
    if sessdata:
        s.cookies.set("SESSDATA", sessdata)
    return s

def get_wbi_keys(session) -> tuple:
    resp = session.get("https://api.bilibili.com/x/web-interface/nav")
    data = resp.json()["data"]["wbi_img"]
    img_key = data["img_url"].split("/")[-1].split(".")[0]
    sub_key = data["sub_url"].split("/")[-1].split(".")[0]
    return img_key, sub_key

def get_mixin_key(img_key, sub_key) -> str:
    raw = img_key + sub_key
    return "".join(raw[i] for i in MIXIN_KEY_ENC_TAB)[:32]

def sign_params(params: dict, mixin_key: str) -> dict:
    params = dict(params)
    params["wts"] = int(time.time())
    sorted_params = dict(sorted(params.items()))
    query = urllib.parse.urlencode(sorted_params)
    params["w_rid"] = hashlib.md5(f"{query}{mixin_key}".encode()).hexdigest()
    return params


def search_videos(keyword: str, session, page: int = 1, page_size: int = 20) -> list:
    """关键词搜索视频"""
    img_key, sub_key = get_wbi_keys(session)
    mixin_key = get_mixin_key(img_key, sub_key)
    params = sign_params({
        "search_type": "video",
        "keyword": keyword,
        "page": page,
        "page_size": page_size,
    }, mixin_key)

    resp = session.get("https://api.bilibili.com/x/web-interface/wbi/search/type", params=params)
    data = resp.json()

    if data["code"] != 0:
        raise Exception(f"搜索失败: {data['message']}")

    return data["data"].get("result", [])


def search_user(keyword: str, session) -> list:
    """搜索UP主"""
    img_key, sub_key = get_wbi_keys(session)
    mixin_key = get_mixin_key(img_key, sub_key)
    params = sign_params({
        "search_type": "bili_user",
        "keyword": keyword,
        "page": 1,
        "page_size": 5,
    }, mixin_key)

    resp = session.get("https://api.bilibili.com/x/web-interface/wbi/search/type", params=params)
    data = resp.json()

    if data["code"] != 0:
        raise Exception(f"搜索UP主失败: {data['message']}")

    return data["data"].get("result", [])


def get_user_videos(mid: int, session, page: int = 1, page_size: int = 30) -> dict:
    """获取UP主所有视频（需要WBI签名）"""
    img_key, sub_key = get_wbi_keys(session)
    mixin_key = get_mixin_key(img_key, sub_key)
    params = sign_params({
        "mid": mid,
        "ps": page_size,
        "pn": page,
        "order": "pubdate",
    }, mixin_key)

    resp = session.get("https://api.bilibili.com/x/space/wbi/arc/search", params=params)
    data = resp.json()

    if data["code"] != 0:
        raise Exception(f"获取视频列表失败: {data['message']}")

    return data["data"]


def print_videos(videos: list, start_idx: int = 1):
    """打印视频列表"""
    from datetime import datetime
    for i, v in enumerate(videos, start_idx):
        bvid = v.get("bvid", "")
        title = v.get("title", "").replace("<em class=\"keyword\">", "").replace("</em>", "")
        author = v.get("author", v.get("name", ""))
        play = v.get("play", v.get("stat", {}).get("view", 0))
        created = v.get("created", 0) or v.get("pubdate", 0)
        pub_time = datetime.fromtimestamp(created).strftime("%Y-%m-%d %H:%M") if created else ""

        print(f"  {i:2d}. [{bvid}] {title}")
        if author:
            print(f"      UP主: {author}  播放: {play:,}  发布: {pub_time}")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="B站视频搜索",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 关键词搜索
  %(prog)s "Python教程"
  %(prog)s "机器学习" -n 30

  # 搜索UP主的所有视频
  %(prog)s "林超" --up
  %(prog)s --mid 123456789

  # 搜索UP主并列出视频
  %(prog)s "影视飓风" --up --videos
        """
    )

    parser.add_argument("query", nargs="?", help="搜索关键词或UP主名称")
    parser.add_argument("-n", "--num", type=int, default=20, help="返回数量 (默认: 20)")
    parser.add_argument("--up", action="store_true", help="搜索UP主")
    parser.add_argument("--mid", type=int, help="直接指定UP主UID获取视频列表")
    parser.add_argument("--videos", action="store_true", help="搜索UP主后列出其视频")
    parser.add_argument("--page", type=int, default=1, help="页码 (默认: 1)")
    parser.add_argument("--sessdata", help="B站SESSDATA Cookie")

    args = parser.parse_args()

    sessdata = args.sessdata or os.environ.get("BILIBILI_SESSDATA")
    session = make_session(sessdata)

    try:
        # 直接通过UID获取UP主视频
        if args.mid:
            print(f"📺 获取UID={args.mid} 的视频列表 (第{args.page}页)...\n")
            data = get_user_videos(args.mid, session, args.page, args.num)
            vlist = data.get("list", {}).get("vlist", [])
            total = data.get("page", {}).get("count", 0)
            print(f"共 {total} 个视频，当前第 {args.page} 页：\n")
            print_videos(vlist)
            return 0

        if not args.query:
            parser.print_help()
            return 1

        # 搜索UP主
        if args.up:
            print(f"🔍 搜索UP主: {args.query}\n")
            users = search_user(args.query, session)

            if not users:
                print("❌ 未找到相关UP主")
                return 1

            for i, u in enumerate(users, 1):
                print(f"  {i}. {u['uname']} (UID: {u['mid']})")
                print(f"     粉丝: {u.get('fans', 0):,}  视频数: {u.get('videos', 0)}")

            # 如果指定了--videos，列出第一个UP主的视频
            if args.videos and users:
                time.sleep(1)
                mid = users[0]["mid"]
                uname = users[0]["uname"]
                print(f"\n📺 {uname} 的视频列表：\n")
                data = get_user_videos(mid, session, args.page, args.num)
                vlist = data.get("list", {}).get("vlist", [])
                total = data.get("page", {}).get("count", 0)
                print(f"共 {total} 个视频，当前第 {args.page} 页：\n")
                print_videos(vlist)

        # 关键词搜索
        else:
            print(f"🔍 搜索: {args.query}\n")
            videos = search_videos(args.query, session, args.page, args.num)

            if not videos:
                print("❌ 未找到相关视频")
                return 1

            print(f"找到 {len(videos)} 个视频：\n")
            print_videos(videos)

        print(f"\n💡 使用 bilibili_subtitle.py <BV号> 获取字幕")
        return 0

    except Exception as e:
        print(f"❌ 错误: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
