#!/usr/bin/env python3
"""
Mesh 交易后端 —— mock 实现（mac 验链路用，绝不接真券商）。

读 stdin 行分隔 JSON-RPC，place_order 回固定 filled 回执。
真盘版（Windows）按同协议接国金 qmt，见 docs/mesh-live-backend-protocol.md。

环境变量 MESH_MOCK_MODE 控制行为（测试用）：
  normal(默认) → filled 回执
  no_ready     → 启动后不发 ready（触发 Node 侧握手超时）
  reject       → rejected 回执
  timeout      → 收到请求不回（触发 Node 侧超时）
  crash        → 收到请求即退出（触发 Node 侧崩溃处理）

协议：
  Node→py(stdin 每行一个 JSON)：
    {"id":"<uuid>","method":"place_order","params":{"symbol","side","qty","price","idempotencyKey"}}
  py→Node(stdout 每行一个 JSON)：
    启动握手 {"type":"ready"}
    回执     {"id":"<uuid>","result":{"status":"filled"|"rejected","filledPrice","filledQty","brokerOrderId","reason"}}
    或错误   {"id":"<uuid>","error":{"message":"..."}}
"""
import sys
import os
import json


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    mode = os.environ.get("MESH_MOCK_MODE", "normal")
    if mode == "no_ready":
        for _ in sys.stdin:
            pass
        return
    emit({"type": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue

        rid = req.get("id")
        method = req.get("method")

        if method != "place_order":
            emit({"id": rid, "error": {"message": "unknown method: %s" % method}})
            continue

        if mode == "crash":
            sys.exit(1)
        if mode == "timeout":
            continue  # 故意不回，触发 Node 侧超时（真钱安全：超时不当成交）

        params = req.get("params", {})
        if mode == "reject":
            emit({"id": rid, "result": {"status": "rejected", "reason": "mock reject"}})
            continue

        # normal: 成交回执（mock 用请求价当成交价）
        emit({"id": rid, "result": {
            "status": "filled",
            "filledPrice": params.get("price", 0),
            "filledQty": params.get("qty", 0),
            "brokerOrderId": "MOCK-" + str(rid)[:8],
        }})


if __name__ == "__main__":
    main()
