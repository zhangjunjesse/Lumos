#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mesh 真行情喂入 —— 从国金 QMT(xtdata)取实时 tick,喂给 Node 的快照 + RiskGate。

这是"去假数据"的真实来源:替代写死的 DEFAULT_SNAPSHOT。和交易后端(qmt_trade_backend.py)
并列、独立——本文件只读行情(安全),不碰下单。

⚠️ 只能在 Windows + 国金 QMT 客户端登录 + 装了 xtquant 的 Python(如 C:\\Python311)上跑。
   mac 上 import xtdata 会失败 → Node 侧 spawn 失败 → 退回空行情(显示"行情未接",不喂假数据)。

协议(行分隔 JSON over stdio,跟交易后端一套):
  Node→py(stdin 每行):{"id","method":"get_ticks","params":{"codes":["600160.SH","300750.SZ"]}}
  py→Node(stdout 每行):
    握手   {"type":"ready"}
    回执   {"id","result":{"ticks":[{"code":"600160.SH","last":45.2,"pct":5.1}]}}
    错误   {"id","error":{"message":"..."}}

env:
  QMT_PATH 仅交易端用;行情 xtdata 通常无需,连不上时按券商客户端是否登录排查。
"""
import sys
import json

_xtdata = None


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg):
    sys.stderr.write("[qmt_quote_feed] %s\n" % msg)
    sys.stderr.flush()


def _ensure_xtdata():
    """惰性导入 xtdata(行情)。mac 上会抛 ImportError → 调用方据此回退空。"""
    global _xtdata
    if _xtdata is None:
        from xtquant import xtdata as _x
        _xtdata = _x
    return _xtdata


def get_ticks(codes):
    """取实时 tick。返回 [{"code","last","pct"}]。pct=当日涨跌幅(%),取不到给 None。"""
    xt = _ensure_xtdata()
    full = xt.get_full_tick(codes)  # {code: {lastPrice, lastClose, ...}}(见 qmt_mcp_server.py / 手册 §4)
    out = []
    for code in codes:
        d = (full or {}).get(code) or {}
        last = d.get("lastPrice")
        prev = d.get("lastClose") or d.get("preClose")  # 字段名按你的 qmt 版本核(手册 §4)
        pct = None
        if last is not None and prev:
            try:
                pct = round((last - prev) / prev * 100, 2)
            except Exception:
                pct = None
        if last is not None:
            out.append({"code": code, "last": last, "pct": pct})
    return out


def handle(req):
    rid = req.get("id")
    if req.get("method") != "get_ticks":
        return {"id": rid, "error": {"message": "unknown method: %s" % req.get("method")}}
    codes = (req.get("params") or {}).get("codes") or []
    if not isinstance(codes, list) or not codes:
        return {"id": rid, "result": {"ticks": []}}
    try:
        return {"id": rid, "result": {"ticks": get_ticks(codes)}}
    except Exception as e:
        log("取行情异常: %s" % e)
        return {"id": rid, "error": {"message": str(e)}}


def main():
    try:
        _ensure_xtdata()  # 启动即验 xtdata 可用;不可用(mac/未装)直接退出,Node 退回空行情
    except Exception as e:
        log("xtdata 不可用,退出(Node 将退回空行情): %s" % e)
        sys.exit(1)
    emit({"type": "ready"})
    log("ready")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        emit(handle(req))


if __name__ == "__main__":
    main()
