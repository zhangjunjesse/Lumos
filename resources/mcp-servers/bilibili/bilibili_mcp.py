#!/usr/bin/env python3
"""B站 MCP Server - 搜索视频、获取字幕"""
import asyncio
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

import bilibili_search as bs
import bilibili_subtitle as bsub

app = Server("bilibili")


@app.list_tools()
async def list_tools():
    return [
        Tool(
            name="search_videos",
            description="搜索B站视频",
            inputSchema={
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词"},
                    "num": {"type": "integer", "description": "返回数量", "default": 10},
                },
                "required": ["keyword"],
            },
        ),
        Tool(
            name="get_subtitle",
            description="获取B站视频字幕（纯文本）",
            inputSchema={
                "type": "object",
                "properties": {
                    "bvid": {"type": "string", "description": "视频BV号或URL"},
                    "lang": {"type": "string", "description": "字幕语言关键词", "default": "zh"},
                },
                "required": ["bvid"],
            },
        ),
        Tool(
            name="search_up_videos",
            description="搜索UP主并获取其最新视频列表",
            inputSchema={
                "type": "object",
                "properties": {
                    "up_name": {"type": "string", "description": "UP主名称"},
                    "num": {"type": "integer", "description": "返回数量", "default": 10},
                },
                "required": ["up_name"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name, arguments):
    sessdata = os.environ.get("BILIBILI_SESSDATA")
    session = bs.make_session(sessdata)
    try:
        if name == "search_videos":
            videos = bs.search_videos(arguments["keyword"], session, page_size=arguments.get("num", 10))
            lines = []
            for i, v in enumerate(videos, 1):
                bvid = v.get("bvid", "")
                title = v.get("title", "").replace('<em class="keyword">', "").replace("</em>", "")
                pub = v.get("pubdate", 0)
                pub_time = datetime.fromtimestamp(pub).strftime("%Y-%m-%d") if pub else ""
                lines.append(f"{i}. [{bvid}] {title}")
                lines.append(f"   UP主: {v.get('author','')}  发布: {pub_time}  https://www.bilibili.com/video/{bvid}")
            return [TextContent(type="text", text="\n".join(lines))]

        elif name == "get_subtitle":
            bvid = bsub.extract_bvid(arguments["bvid"])
            if not bvid:
                return [TextContent(type="text", text="无法识别的视频ID")]
            info = bsub.get_video_info(session, bvid)
            subs = bsub.get_subtitle_list(session, bvid, info["cid"])
            if not subs:
                return [TextContent(type="text", text=f"《{info['title']}》没有可用字幕")]
            lang = arguments.get("lang", "zh")
            target = next((s for s in subs if lang in s["lan"]), subs[0])
            data = bsub.download_subtitle(target["subtitle_url"])
            return [TextContent(type="text", text=f"《{info['title']}》({target['lan_doc']}):\n\n{bsub.to_txt(data)}")]

        elif name == "search_up_videos":
            users = bs.search_user(arguments["up_name"], session)
            if not users:
                return [TextContent(type="text", text=f"未找到UP主: {arguments['up_name']}")]
            u = users[0]
            time.sleep(0.5)
            data = bs.get_user_videos(u["mid"], session, page_size=arguments.get("num", 10))
            vlist = data.get("list", {}).get("vlist", [])
            lines = [f"UP主: {u['uname']} (UID: {u['mid']})\n"]
            for i, v in enumerate(vlist, 1):
                bvid = v.get("bvid", "")
                created = v.get("created", 0)
                pub_time = datetime.fromtimestamp(created).strftime("%Y-%m-%d") if created else ""
                lines.append(f"{i}. [{bvid}] {v.get('title', '')}")
                lines.append(f"   发布: {pub_time}  https://www.bilibili.com/video/{bvid}")
            return [TextContent(type="text", text="\n".join(lines))]

    except Exception as e:
        return [TextContent(type="text", text=f"错误: {e}")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
