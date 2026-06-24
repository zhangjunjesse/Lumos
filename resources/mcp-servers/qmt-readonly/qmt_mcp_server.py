# -*- coding: utf-8 -*-
"""
QMT 只读 MCP Server (read-only)
======================================
把已实测验证过的 QMT 行情/账户查询能力封装为 MCP 工具,供 Claude 直接调用。

红线:
  - 本文件只做【只读】:行情、涨跌停、资产、持仓、当日委托/成交。
  - 不含任何下单/撤单函数。交易档将在独立文件 + 显式护栏后单独提供。

运行环境(硬约束):
  - 必须用 C:\\Python311\\python.exe 运行 —— xtquant 只装在 Python311/36,Lumos venv 没有。
  - 运行前 QMT 客户端(国金证券QMT交易端)必须已登录在线,否则连接失败。

连接参数(可被环境变量覆盖):
  - QMT_PATH       默认 C:\\国金证券QMT交易端\\userdata_mini(标准安装路径,可在「数据源」改)
  - QMT_ACCOUNT_ID 必填:在 Lumos「数据源」填,或 env QMT_ACCOUNT_ID(内置版不写死个人账户)
"""
import os
import sys
import time
import threading
from typing import Optional

from mcp.server.fastmcp import FastMCP

# ---------------- 配置 ----------------
QMT_PATH = os.environ.get("QMT_PATH", r"C:\国金证券QMT交易端\userdata_mini")
QMT_ACCOUNT_ID = os.environ.get("QMT_ACCOUNT_ID", "")  # 走 Lumos「数据源」配置,内置版不写死个人账户

mcp = FastMCP("qmt-readonly")

# ---------------- 交易端懒连接(单例) ----------------
_lock = threading.Lock()
_xt = None          # XtQuantTrader 实例
_acc = None         # StockAccount 实例
_xtdata = None      # xtdata 模块


def _ensure_xtdata():
    """惰性导入 xtdata(行情)。"""
    global _xtdata
    if _xtdata is None:
        from xtquant import xtdata as _x
        _xtdata = _x
    return _xtdata


def _ensure_trader():
    """惰性建立交易端连接并复用。返回 (xt_trader, account)。连接失败抛异常。"""
    global _xt, _acc
    with _lock:
        if _xt is not None and _acc is not None:
            return _xt, _acc
        from xtquant.xttrader import XtQuantTrader
        from xtquant.xttype import StockAccount
        session_id = int(time.time())
        xt = XtQuantTrader(QMT_PATH, session_id)
        xt.start()
        ret = xt.connect()
        if ret != 0:
            raise RuntimeError(
                f"交易端连接失败 connect_ret={ret} (0 才是成功)。"
                f"请确认 QMT 客户端已登录、path={QMT_PATH} 正确。"
            )
        acc = StockAccount(QMT_ACCOUNT_ID)
        _xt, _acc = xt, acc
        return _xt, _acc


def _g(obj, *names, default=None):
    """按顺序取第一个存在的属性(兼容新旧字段名)。"""
    for n in names:
        if hasattr(obj, n):
            return getattr(obj, n)
    return default


# ---------------- 同花顺热榜(纯 HTTP,不依赖 QMT/浏览器) ----------------
# 数据接口实测可裸 requests 拉取,无需 cookie。来源:同花顺热榜 H5 页面后端 API。
import json as _json
import urllib.request as _urlreq

_THS_HOST = "https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1"
_THS_BLOCK_API = "https://dq.10jqka.com.cn/interval_calculation/block_info/v1/get_block_list"


def _ths_post_json(url: str, payload: dict) -> dict:
    """POST JSON 到同花顺接口,返回 data 部分,失败抛异常。"""
    data = _json.dumps(payload).encode("utf-8")
    req = _urlreq.Request(
        url, data=data,
        headers={"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"},
        method="POST",
    )
    with _urlreq.urlopen(req, timeout=12) as r:
        j = _json.loads(r.read().decode("utf-8"))
    if j.get("status_code") != 0:
        raise RuntimeError(f"接口返回异常 status_code={j.get('status_code')} msg={j.get('status_msg')}")
    return j.get("data", {})


def _ths_code_suffix(code: str) -> str:
    """按代码前缀推断交易所后缀(稳,不依赖 market 数字字段)。"""
    c = str(code)
    if c.startswith(("6", "9")):
        return f"{c}.SH"
    if c.startswith(("0", "3", "2")):
        return f"{c}.SZ"
    if c.startswith(("8", "4")):
        return f"{c}.BJ"
    return c


def _ths_fetch(path: str) -> dict:
    """拉取同花顺热榜接口,返回解析后的 data 部分,失败抛异常。"""
    url = f"{_THS_HOST}/{path}"
    req = _urlreq.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with _urlreq.urlopen(req, timeout=10) as r:
        j = _json.loads(r.read().decode("utf-8"))
    if j.get("status_code") != 0:
        raise RuntimeError(f"接口返回异常 status_code={j.get('status_code')} msg={j.get('status_msg')}")
    return j.get("data", {})


# ---------------- 行情工具 ----------------
@mcp.tool()
def qmt_get_tick(codes: str) -> dict:
    """获取一个或多个股票的实时盘口快照(最新价/开高低/昨收/成交量额)。

    Args:
        codes: 股票代码,逗号分隔,需带交易所后缀,如 "000001.SZ,600160.SH"。
    Returns:
        {代码: {lastPrice, open, high, low, lastClose, volume, amount, timetag}}
    """
    xd = _ensure_xtdata()
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    raw = xd.get_full_tick(code_list)
    out = {}
    for c in code_list:
        d = raw.get(c, {})
        out[c] = {
            "lastPrice": d.get("lastPrice"),
            "open": d.get("open"),
            "high": d.get("high"),
            "low": d.get("low"),
            "lastClose": d.get("lastClose"),
            "volume": d.get("volume"),
            "amount": d.get("amount"),
            "timetag": d.get("timetag"),
        }
    return {"ok": True, "ticks": out}


@mcp.tool()
def qmt_get_limit_price(code: str) -> dict:
    """获取单只股票的涨停价/跌停价/昨收(打板判断核心)。

    Args:
        code: 股票代码,带后缀,如 "000001.SZ"。
    Returns:
        {name, up_stop, down_stop, pre_close}
    """
    xd = _ensure_xtdata()
    detail = xd.get_instrument_detail(code)
    if not detail:
        return {"ok": False, "error": f"未取到 {code} 合约信息(可能未订阅/代码错误)"}
    return {
        "ok": True,
        "code": code,
        "name": detail.get("InstrumentName"),
        "up_stop": detail.get("UpStopPrice"),
        "down_stop": detail.get("DownStopPrice"),
        "pre_close": detail.get("PreClose"),
        "settlement": detail.get("SettlementPrice"),
    }


# ---------------- 账户查询工具 ----------------
@mcp.tool()
def qmt_query_account() -> dict:
    """查询账户资产:总资产/可用现金/持仓市值/冻结资金。"""
    xt, acc = _ensure_trader()
    a = xt.query_stock_asset(acc)
    if a is None:
        return {"ok": False, "error": "query_stock_asset 返回 None(账户未就绪)"}
    return {
        "ok": True,
        "account_id": QMT_ACCOUNT_ID,
        "total_asset": _g(a, "total_asset", "m_dTotalAsset"),
        "cash": _g(a, "cash", "m_dCash"),
        "market_value": _g(a, "market_value", "m_dMarketValue"),
        "frozen_cash": _g(a, "frozen_cash", "m_dFrozenCash"),
    }


@mcp.tool()
def qmt_query_positions(with_pnl: bool = False) -> dict:
    """查询当前全部持仓。

    Args:
        with_pnl: True 时叠加实时最新价并计算浮动盈亏(会多拉一次行情)。
    Returns:
        {ok, count, positions:[{code,volume,can_use,avg_price,market_value,
                                 (last_price,float_profit,profit_pct)}]}
    """
    xt, acc = _ensure_trader()
    positions = xt.query_stock_positions(acc) or []
    items = []
    code_list = []
    for p in positions:
        vol = _g(p, "volume", "m_nVolume", default=0)
        if not vol or vol <= 0:
            continue
        code = _g(p, "stock_code", "m_strStockCode")
        code_list.append(code)
        items.append({
            "code": code,
            "volume": vol,
            "can_use": _g(p, "can_use_volume", "m_nCanUseVolume"),
            "avg_price": _g(p, "avg_price", "m_dAvgPrice"),
            "market_value": _g(p, "market_value", "m_dMarketValue"),
            "frozen_volume": _g(p, "frozen_volume", "m_nFrozenVolume"),
        })
    if with_pnl and code_list:
        xd = _ensure_xtdata()
        ticks = xd.get_full_tick(code_list)
        for it in items:
            last = (ticks.get(it["code"]) or {}).get("lastPrice")
            it["last_price"] = last
            if last and it["avg_price"]:
                it["float_profit"] = round((last - it["avg_price"]) * it["volume"], 2)
                it["profit_pct"] = round((last / it["avg_price"] - 1) * 100, 2)
    return {"ok": True, "count": len(items), "positions": items}


@mcp.tool()
def qmt_query_orders(cancelable_only: bool = False) -> dict:
    """查询当日委托。

    Args:
        cancelable_only: True 仅返回可撤(未完成)委托。
    Returns:
        {ok, count, orders:[{order_id,code,side,price,volume,traded,status,status_msg}]}
    """
    xt, acc = _ensure_trader()
    orders = xt.query_stock_orders(acc, cancelable_only) or []
    items = []
    for o in orders:
        items.append({
            "order_id": _g(o, "order_id", "m_nOrderID"),
            "code": _g(o, "stock_code", "m_strStockCode"),
            "side": _g(o, "order_type", "m_nOrderType"),
            "price": _g(o, "price", "m_dPrice"),
            "volume": _g(o, "order_volume", "m_nOrderVolume"),
            "traded": _g(o, "traded_volume", "m_nTradedVolume"),
            "status": _g(o, "order_status", "m_nOrderStatus"),
            "status_msg": _g(o, "status_msg", "m_strStatusMsg"),
        })
    return {"ok": True, "count": len(items), "orders": items}


@mcp.tool()
def qmt_query_trades() -> dict:
    """查询当日成交明细。

    Returns:
        {ok, count, trades:[{trade_id,order_id,code,price,volume,amount,time}]}
    """
    xt, acc = _ensure_trader()
    trades = xt.query_stock_trades(acc) or []
    items = []
    for t in trades:
        items.append({
            "trade_id": _g(t, "traded_id", "m_strTradeID"),
            "order_id": _g(t, "order_id", "m_nOrderID"),
            "code": _g(t, "stock_code", "m_strStockCode"),
            "price": _g(t, "traded_price", "m_dPrice"),
            "volume": _g(t, "traded_volume", "m_nVolume"),
            "amount": _g(t, "traded_amount", "m_dTradeAmount"),
            "time": _g(t, "traded_time", "m_strTradeTime"),
        })
    return {"ok": True, "count": len(items), "trades": items}


# ---------------- 同花顺热榜工具 ----------------
@mcp.tool()
def ths_hot_stocks(period: str = "hour", list_type: str = "normal", top: int = 20) -> dict:
    """获取同花顺个股热榜(实盘快速看热点)。纯HTTP,不依赖QMT/浏览器。

    Args:
        period: "hour"=1小时回溯, "day"=24小时回溯。默认 hour。
        list_type: 榜单类型——
            "normal"=热股主榜, "skyrocket"=快速飙升,
            "tech"=技术派, "value"=价值派, "trend"=趋势派。默认 normal。
        top: 返回前 N 条。默认 20,接口最多 100。
    Returns:
        {ok,count,period,list_type,stocks:[{order,name,code,suffix_code,
          rise_and_fall,hot_value,rank_chg,popularity_tag,concepts,analyse_title}]}
        popularity_tag(几天几板/首板涨停)是打板核心信号。
    """
    try:
        data = _ths_fetch(f"stock?stock_type=a&type={period}&list_type={list_type}")
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    raw = data.get("stock_list", []) or []
    stocks = []
    for it in raw[:max(1, top)]:
        code = it.get("code")
        tag = it.get("tag", {}) or {}
        rate = it.get("rate")
        try:
            hot_value = int(float(rate)) if rate is not None else None
        except (ValueError, TypeError):
            hot_value = rate
        stocks.append({
            "order": it.get("order"),
            "name": it.get("name"),
            "code": code,
            "suffix_code": _ths_code_suffix(code),
            "rise_and_fall": it.get("rise_and_fall"),
            "hot_value": hot_value,
            "rank_chg": it.get("hot_rank_chg"),
            "popularity_tag": tag.get("popularity_tag"),
            "concepts": tag.get("concept_tag"),
            "analyse_title": it.get("analyse_title"),
        })
    return {"ok": True, "count": len(stocks), "period": period,
            "list_type": list_type, "stocks": stocks}


@mcp.tool()
def ths_hot_stock_analyse(code: str, period: str = "hour") -> dict:
    """获取某热榜个股的完整AI异动归因(行业原因+公司原因全文)。

    Args:
        code: 6位股票代码,如 "600110"(热榜返回的 code 字段)。
        period: "hour" 或 "day"。默认 hour。
    Returns:
        {ok,name,code,analyse_title,analyse} —— 未在当前榜单中则 ok=False。
    """
    try:
        data = _ths_fetch(f"stock?stock_type=a&type={period}&list_type=normal")
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    for it in (data.get("stock_list", []) or []):
        if str(it.get("code")) == str(code):
            return {"ok": True, "name": it.get("name"), "code": code,
                    "analyse_title": it.get("analyse_title"),
                    "analyse": it.get("analyse")}
    return {"ok": False, "error": f"{code} 不在当前 {period} 热股主榜中"}


@mcp.tool()
def ths_hot_plates(plate_type: str = "concept", top: int = 15) -> dict:
    """获取同花顺热门板块榜(概念/行业)。

    Args:
        plate_type: "concept"=概念板块, "industry"=行业板块。默认 concept。
        top: 返回前 N 条。默认 15。
    Returns:
        {ok,count,plate_type,plates:[...原始字段...]}
    """
    try:
        data = _ths_fetch(f"plate?type={plate_type}")
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    # 板块接口结构未逐字段固化,先找列表键透传,避免臆测字段名
    plates = None
    for k, v in data.items():
        if isinstance(v, list):
            plates = v
            break
    if plates is None:
        return {"ok": False, "error": f"未在返回中找到板块列表,data keys={list(data.keys())}"}
    return {"ok": True, "count": min(len(plates), top),
            "plate_type": plate_type, "plates": plates[:max(1, top)]}


@mcp.tool()
def ths_sector_review(period: str = "day", category: int = 0, top: int = 20,
                      sort_field: str = "0", date: str = "") -> dict:
    """同花顺板块复盘统计:按区间看各板块涨幅/主力净流入/成交额/区间领涨股。
    适合判断当日资金主线、风口板块。纯HTTP,不依赖QMT/浏览器。

    Args:
        period: "day"=单日(当天09:30-15:00), "multi"=多日(近10个自然日)。默认 day。
        category: 板块分类 0=全部(实测有效)。其余分类(行业/概念/风格/地域)编号未逐一固化。
        top: 返回前 N 个板块。默认 20。
        sort_field: 排序字段,"0"=默认(按涨幅)。
        date: 单日模式指定日期 YYYYMMDD,留空=今天。多日模式作为结束日。
    Returns:
        {ok,count,period,sectors:[{block_code,block_name,margin_pct,
          main_net_inflow,turnover,leaders:[{code,name,pct}]}]}
        margin_pct=区间涨幅%, main_net_inflow=主力净流入(元), turnover=成交额(元)。
    """
    import datetime as _dt
    today = date or _dt.datetime.now().strftime("%Y%m%d")
    if period == "multi":
        history_type = "1"
        start = (_dt.datetime.strptime(today, "%Y%m%d") - _dt.timedelta(days=13)).strftime("%Y%m%d")
        start_date = start + "000000"
        end_date = today + "000000"
    else:
        history_type = "0"
        start_date = today + "093000"
        end_date = today + "150000"
    payload = {
        "type": category,
        "history_info": {"history_type": history_type, "start_date": start_date, "end_date": end_date},
        "page_info": {"page": 1, "page_size": max(1, top)},
        "sort_info": {"sort_field": sort_field, "sort_type": "desc"},
    }
    try:
        data = _ths_post_json(_THS_BLOCK_API, payload)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    raw = data.get("list", []) or []
    sectors = []
    for b in raw[:max(1, top)]:
        leaders = []
        for s in (b.get("stock_list", []) or []):
            pct = s.get("margin_of_increase")
            leaders.append({
                "code": s.get("stock_code"),
                "suffix_code": _ths_code_suffix(s.get("stock_code")),
                "name": s.get("stock_name"),
                "pct": round(pct * 100, 2) if isinstance(pct, (int, float)) else pct,
            })
        mi = b.get("margin_of_increase")
        sectors.append({
            "block_code": b.get("block_code"),
            "block_name": b.get("block_name"),
            "margin_pct": round(mi * 100, 2) if isinstance(mi, (int, float)) else mi,
            "main_net_inflow": b.get("net_inflow_of_main_force"),
            "turnover": b.get("turnover"),
            "leaders": leaders,
        })
    return {"ok": True, "count": len(sectors), "period": period,
            "total": data.get("total"), "sectors": sectors}


# ---------------- 财经快讯(同花顺 flash,纯 HTTP,不依赖 QMT/浏览器) ----------------
_THS_FLASH_URL = "https://news.10jqka.com.cn/app/flash/flashnews/v1/list"
# 快讯分类:中文名 → tagId。也可直接给 tagId 数字。
THS_NEWS_TAGS = {
    "A股": 21101, "重要": 62857, "公告": 34843,
    "期货": 33775, "异动": 21111, "港股": 21105, "美股": 21107,
}


def _resolve_news_tag(tag: str) -> int:
    """把分类名(或 tagId 字符串)解析成 tagId 数字。"""
    t = str(tag or "").strip()
    if t in THS_NEWS_TAGS:
        return THS_NEWS_TAGS[t]
    if t.isdigit():
        return int(t)
    raise RuntimeError(f"未知快讯分类:{tag};可选 {list(THS_NEWS_TAGS)},或直接传 tagId")


def _ths_flash_page(tag_id: int, seq: int) -> list:
    """拉一页 flash 快讯。seq=0 取最新一页;seq>0 取比它更旧的一页(接口的 seq 是向旧翻的游标)。"""
    url = f"{_THS_FLASH_URL}?seq={int(seq)}&tagId={int(tag_id)}"
    req = _urlreq.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with _urlreq.urlopen(req, timeout=10) as r:
        j = _json.loads(r.read().decode("utf-8"))
    code = j.get("status_code")
    if code not in (0, None):
        raise RuntimeError(f"快讯接口异常 status_code={code} msg={j.get('status_msg')}")
    return (j.get("data") or {}).get("list") or []


def _shape_news(it: dict) -> dict:
    """裁剪成精简新闻条目(去掉分享/图片等噪声)。"""
    ts = it.get("createTime") or it.get("updateTime") or 0
    return {
        "seq": it.get("seq"),
        "title": it.get("title"),
        "summary": it.get("summary"),
        "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else "",
        "url": it.get("url"),
        "stocks": [{"code": s.get("stockCode"), "name": s.get("name")} for s in (it.get("stocks") or [])],
    }


@mcp.tool()
def ths_news(tag: str = "重要", top: int = 20) -> dict:
    """获取同花顺财经快讯【最新全量】一批(纯 HTTP,不依赖 QMT)。

    Args:
        tag: 分类,可选 A股/重要/公告/期货/异动/港股/美股,或直接传 tagId 数字。
        top: 返回条数上限(默认 20)。
    Returns:
        {ok, tag, count, latest_seq, news:[{seq,title,summary,time,url,stocks}]}
        latest_seq=本批最大 seq;下次调 ths_news_incremental 把它当 since_seq 传,即可只取新增。
    """
    tag_id = _resolve_news_tag(tag)
    items = _ths_flash_page(tag_id, 0)[: max(1, int(top))]
    news = [_shape_news(it) for it in items]
    latest_seq = max((n["seq"] for n in news if n.get("seq")), default=0)
    return {"ok": True, "tag": tag, "count": len(news), "latest_seq": latest_seq, "news": news}


@mcp.tool()
def ths_news_incremental(tag: str = "重要", since_seq: int = 0, max_scan: int = 100) -> dict:
    """获取同花顺财经快讯【增量】:只返回比 since_seq 更新的快讯(纯 HTTP)。

    用法:先用 ths_news 拿到 latest_seq 记下,之后每轮把它当 since_seq 传进来,只拿新增的。
    Args:
        tag: 分类,同 ths_news。
        since_seq: 上次见过的最大 seq;只返回 seq > since_seq 的。传 0 等于只取最新一页。
        max_scan: since_seq 较旧时最多向旧翻多少条补齐(默认 100,防翻不完)。
    Returns:
        {ok, tag, count, since_seq, latest_seq, news:[...]}  news 为 seq>since_seq 的新快讯(新→旧)。
    """
    tag_id = _resolve_news_tag(tag)
    since = int(since_seq or 0)
    collected: list = []
    seq = 0
    reached = False
    while not reached and len(collected) < max(1, int(max_scan)):
        page = _ths_flash_page(tag_id, seq)
        if not page:
            break
        for it in page:
            s = it.get("seq") or 0
            if since and s <= since:
                reached = True
                break
            collected.append(it)
        if not since:  # since=0:只取最新一页(等同全量)
            break
        seq = page[-1].get("seq")  # 继续往旧翻补齐
    news = [_shape_news(it) for it in collected[: max(1, int(max_scan))]]
    latest_seq = max((n["seq"] for n in news if n.get("seq")), default=since)
    return {"ok": True, "tag": tag, "count": len(news), "since_seq": since, "latest_seq": latest_seq, "news": news}


@mcp.tool()
def qmt_health() -> dict:
    """健康检查:确认行情服务与交易端连接是否正常(只读探针)。"""
    status = {"python": sys.executable, "qmt_path": QMT_PATH, "account": QMT_ACCOUNT_ID}
    try:
        xd = _ensure_xtdata()
        status["xtdata"] = "ok"
    except Exception as e:
        status["xtdata"] = f"FAIL: {type(e).__name__}: {e}"
    try:
        _ensure_trader()
        status["trader"] = "connected"
    except Exception as e:
        status["trader"] = f"FAIL: {type(e).__name__}: {e}"
    return status


if __name__ == "__main__":
    mcp.run()
