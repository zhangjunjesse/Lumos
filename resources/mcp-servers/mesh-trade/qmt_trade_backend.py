#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mesh 真盘交易后端 —— 接国金 QMT(xtquant)真实下单。

⚠️⚠️⚠️ 真金白银,务必先读:
  1. 只能在 Windows + 国金 QMT 客户端 + 装了 xtquant 的 Python(如 C:\\Python311)上跑。
  2. 默认 DRY_RUN=1(空跑,不真下单,只回 rejected 标记)。审完代码、盘后/小单验过回执链路,
     再设 MESH_TRADE_DRY_RUN=0 才会真报单。
  3. 本文件作者(Claude)在 mac 上写的,**没有也无法用真 qmt 实测**。下单调用按
     《QMT_接口手册_for_claude.md》§2.2/§2.5/§164 写,你必须在 Windows 上:
       - 先 DRY_RUN 跑通 IPC 链路(Node 侧 ticket/账户/幂等);
       - 再用最小一手、限价单、盘后或模拟环境验真实回执;
       - 确认 filled_price/filled_quantity 正确、幂等不重下,才上实盘。
  4. Node 侧已做:幂等去重、回执超时=halt、崩溃=halt、异常成交=halt(见
     docs/mesh-live-backend-protocol.md)。后端只管:读请求→下单→回一条回执(成/拒)。

协议(行分隔 JSON over stdio):
  Node→py(stdin 每行):{"id","method":"place_order","params":{"symbol","side","qty","price","idempotencyKey"}}
  py→Node(stdout 每行):
    握手   {"type":"ready"}            # 启动必发,Node 等到它才发单
    回执   {"id","result":{"status":"filled"|"rejected","filledPrice","filledQty","brokerOrderId","reason"}}
    错误   {"id","error":{"message"}}

env:
  MESH_TRADE_DRY_RUN   默认 "1"(空跑)。设 "0" 才真下单。
  QMT_PATH             默认 C:\\国金证券QMT交易端\\userdata_mini
  QMT_ACCOUNT_ID       默认 8886602018
  MESH_TRADE_FILL_TIMEOUT  等成交秒数,默认 8(**必须 < Node 请求超时 10s**,否则 Node 先超时 halt、
                           本脚本的撤单/部分成交逻辑来不及跑。要更长,Node 侧 requestTimeoutMs 也要一起加大。
"""
import sys
import os
import json
import time

QMT_PATH = os.environ.get("QMT_PATH", r"C:\国金证券QMT交易端\userdata_mini")
QMT_ACCOUNT_ID = os.environ.get("QMT_ACCOUNT_ID", "8886602018")
DRY_RUN = os.environ.get("MESH_TRADE_DRY_RUN", "1") != "0"
FILL_TIMEOUT = float(os.environ.get("MESH_TRADE_FILL_TIMEOUT", "6"))  # 轮询上限;须留够"撤单+sleep"裕量,总耗时 < Node 请求超时(12s)
PRICE_CAGE = float(os.environ.get("MESH_TRADE_PRICE_CAGE", "0.005"))  # 价格笼子:买上浮/卖下压比例,提高限价单成交率(0=关)

_xt = None   # XtQuantTrader 实例
_acc = None  # StockAccount 实例


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg):
    # 日志走 stderr,绝不污染 stdout 的 JSON 协议
    sys.stderr.write("[qmt_trade_backend] %s\n" % msg)
    sys.stderr.flush()


def _ensure_trader():
    """惰性建立交易端连接并复用(复用 qmt_mcp_server.py 的连接方式)。失败抛异常。"""
    global _xt, _acc
    if _xt is not None and _acc is not None:
        return _xt, _acc
    from xtquant.xttrader import XtQuantTrader
    from xtquant.xttype import StockAccount
    session_id = int(time.time())
    xt = XtQuantTrader(QMT_PATH, session_id)
    xt.start()
    if xt.connect() != 0:
        raise RuntimeError("连接 QMT 交易端失败(检查 QMT 客户端是否登录、QMT_PATH 是否对)")
    acc = StockAccount(QMT_ACCOUNT_ID)
    if xt.subscribe(acc) != 0:
        raise RuntimeError("订阅交易账户回报失败")
    _xt, _acc = xt, acc
    return _xt, _acc


def _cage_price(symbol, side, price):
    """价格笼子:买入上浮 / 卖出下压(提高限价单成交率),并封顶涨停 / 跌停。
    ⚠️ 涨跌停按昨收 ×1.1 / ×0.9 算,**未单独处理 ST(±5%)**——交易 ST 自行调 PRICE_CAGE 或改这里。"""
    p = float(price)
    if PRICE_CAGE <= 0:
        return round(p, 2)
    caged = p * (1 + PRICE_CAGE) if side == "buy" else p * (1 - PRICE_CAGE)
    try:  # 取昨收算涨跌停封顶;取不到就只上浮/下压,靠券商挡越界
        from xtquant import xtdata
        d = (xtdata.get_full_tick([symbol]) or {}).get(symbol) or {}
        prev = d.get("lastClose") or d.get("preClose")
        if prev:
            up, down = round(prev * 1.1, 2), round(prev * 0.9, 2)
            caged = min(caged, up) if side == "buy" else max(caged, down)
    except Exception as e:
        log("涨跌停封顶取昨收失败,仅上浮/下压: %s" % e)
    return round(caged, 2)


def _place_qmt_order(symbol, side, qty, price, remark):
    """
    真实下单 + 等成交回执。返回 {status, filledPrice, filledQty, brokerOrderId} 或 {status:'rejected', reason}.

    ⚠️ 这是按手册 §2.2 的低层 order_stock 写的参考实现,你在 Windows 上必须核对:
       - XtOrder 的状态/字段名(order_status / traded_volume / traded_price / order_sysid)随 qmt 版本可能不同(见手册 §3);
       - 若你有 utils.trade.StockTrader(daban_01 在用,手册 §2.5/§164),**优先用它**的
         buy_stock_with_retry / sell_stock_with_retry(price_type="limit"),它同步返回
         result['status']=='filled' + filled_price/filled_quantity,比下面这套轮询更稳。
    """
    from xtquant import xtconstant
    xt, acc = _ensure_trader()
    op = xtconstant.STOCK_BUY if side == "buy" else xtconstant.STOCK_SELL
    qty = int(qty)
    price = _cage_price(symbol, side, price)  # 价格笼子(买上浮/卖下压、封顶涨跌停)提高成交率

    def find_order():
        # 按 order_remark 查本地委托对象(找不到 None)。⚠️ 字段名按你 qmt 版本核(手册 §3)。
        try:
            for o in xt.query_stock_orders(acc, False):  # False=全部委托(手册 §2.1)
                if getattr(o, "order_remark", None) == remark:
                    return o
        except Exception as e:
            log("query_stock_orders 失败: %s" % e)
        return None

    def fill_of(o):
        # 据【实际成交量】回执,支持部分成交(filledQty 可能 < 请求量)。
        traded = int(getattr(o, "traded_volume", 0) or 0)
        tprice = float(getattr(o, "traded_price", 0) or 0) or float(price)
        sysid = getattr(o, "order_sysid", "") or getattr(o, "order_id", "")
        return {"status": "filled", "filledPrice": tprice, "filledQty": traded, "brokerOrderId": str(sysid)}

    # 只用限价(FIX_PRICE),不用市价(手册 §2.2 关键事实)
    order_id = xt.order_stock(acc, symbol, op, qty, xtconstant.FIX_PRICE, float(price), "mesh", remark)
    if order_id is None or order_id < 0:
        return {"status": "rejected", "reason": "order_stock 返回 %s(报单失败)" % order_id}

    succeeded = getattr(xtconstant, "ORDER_SUCCEEDED", 56)
    terminal_bad = {getattr(xtconstant, "ORDER_JUNK", 57), getattr(xtconstant, "ORDER_CANCELED", 54)}
    deadline = time.time() + FILL_TIMEOUT
    while time.time() < deadline:
        o = find_order()
        if o is not None:
            status = getattr(o, "order_status", None)
            traded = int(getattr(o, "traded_volume", 0) or 0)
            if status == succeeded or traded >= qty:            # 全部成交
                return fill_of(o)
            if status in terminal_bad:                           # 废/撤等终态:有成交记部分,无则拒
                return fill_of(o) if traded > 0 else {"status": "rejected", "reason": "委托终态 status=%s" % status}
        time.sleep(0.5)

    # 超时:先撤单止住后续成交(避免"已回拒却又晚成交"失控),再按实际成交量据实回执。
    # ⚠️ 撤单用【查到的委托 order_id】,不是 order_stock 的返回值——手册 §2.1 它"0=成功"是状态码、非可撤 id。
    o = find_order()
    if o is not None:
        try:
            cancel_id = getattr(o, "order_id", None)
            if cancel_id is None:
                cancel_id = order_id  # 兜底:个别 qmt 版本 order_stock 直接返回 order_id
            xt.cancel_order_stock(acc, cancel_id)
        except Exception as e:
            log("超时撤单异常: %s" % e)
    time.sleep(1.0)  # 给撤单/末次成交回报一点时间
    o = find_order()
    traded = int(getattr(o, "traded_volume", 0) or 0) if o is not None else 0
    if traded > 0:
        return fill_of(o)                                        # 部分成交:据实记(剩余已撤)
    return {"status": "rejected", "reason": "等成交超时 %ss,已撤单,无成交" % FILL_TIMEOUT}


def handle(req):
    rid = req.get("id")
    if req.get("method") != "place_order":
        return {"id": rid, "error": {"message": "unknown method: %s" % req.get("method")}}
    p = req.get("params", {})
    symbol, side = p.get("symbol"), p.get("side")
    qty, price = p.get("qty"), p.get("price")
    remark = p.get("idempotencyKey") or str(rid)
    if not symbol or side not in ("buy", "sell") or not qty or not price:
        return {"id": rid, "result": {"status": "rejected", "reason": "参数缺失/非法"}}

    if DRY_RUN:
        log("DRY_RUN 空跑,不真下单: %s %s %sx%s @%s" % (side, symbol, qty, "", price))
        return {"id": rid, "result": {"status": "rejected",
                "reason": "DRY_RUN 空跑(设 MESH_TRADE_DRY_RUN=0 才真下单)"}}

    try:
        result = _place_qmt_order(symbol, side, qty, price, remark)
        return {"id": rid, "result": result}
    except Exception as e:
        # 异常(含 QMT 断线)→ 清连接,下一单重连(MEDIUM-2);本单回 error,Node 当拒单不 halt。
        global _xt, _acc
        _xt = _acc = None
        log("下单异常,已清连接(下次重连): %s" % e)
        return {"id": rid, "error": {"message": str(e)}}


def main():
    # 真盘:启动即连 qmt,让 ready=已连接——首单不再付连接耗时(否则连接+下单可能撞 Node 10s 超时)。
    # DRY_RUN 不真下单,跳过连接(mac/没 qmt 也能起来验链路)。连接失败即退出 → Node 握手超时 → halt(fail-fast)。
    if not DRY_RUN:
        try:
            _ensure_trader()
        except Exception as e:
            log("启动连接 QMT 失败,退出(Node 握手超时→halt): %s" % e)
            sys.exit(1)
    # 幂等:seen 仅【本进程内】防同一请求的网络重试;进程重启即清空。
    # 真正的持久防线是 Node 侧:ticket idempotency_key UNIQUE + live-pending 直接返回 + halted 总闸(halt 后请求被 RiskGate 最先一关拦死,根本不到这层)。
    seen = {}
    emit({"type": "ready"})
    log("ready (DRY_RUN=%s, account=%s)" % (DRY_RUN, QMT_ACCOUNT_ID))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        key = (req.get("params") or {}).get("idempotencyKey")
        if key and key in seen:
            cached = dict(seen[key])
            cached["id"] = req.get("id")
            emit(cached)
            continue
        resp = handle(req)
        if key and "result" in resp:
            seen[key] = resp
        emit(resp)


if __name__ == "__main__":
    main()
