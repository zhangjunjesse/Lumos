# Mesh 真盘后端协议（Node ↔ Python）

OrderGateway 的 live 下单通过一个 **Python 子进程**完成：Node 侧（`src/lib/mesh/mesh-live-backend.ts`）`spawn` 一个 Python 脚本，用 **JSON-RPC over stdio（行分隔 JSON）** 通信。mac 上用 mock 脚本验链路；Windows 上换成接国金 qmt 的真实脚本即可真下单。

## 协议

**Node → Python（stdin，每行一个 JSON）**

```json
{"id":"<uuid>","method":"place_order","params":{"symbol":"600160.SH","side":"buy","qty":100,"price":45.2,"idempotencyKey":"<唯一键>"}}
```

**Python → Node（stdout，每行一个 JSON）**

- 启动握手（必须，Node 等到它才发单）：
  ```json
  {"type":"ready"}
  ```
- 下单回执：
  ```json
  {"id":"<uuid>","result":{"status":"filled","filledPrice":45.2,"filledQty":100,"brokerOrderId":"<券商单号>"}}
  ```
  或
  ```json
  {"id":"<uuid>","result":{"status":"rejected","reason":"<拒单原因>"}}
  ```
- 错误：
  ```json
  {"id":"<uuid>","error":{"message":"<错误>"}}
  ```

## 真钱安全语义（Node 侧已实现，后端须配合）

- **幂等键防重复下单**：`idempotencyKey` 全局唯一（`runId:agentId:idx`）。后端**必须**用它去重——同 key 不可重复报单。Node 侧 ticket 也有 `idempotency_key UNIQUE` 兜底；如果同 key 已经处于 live `pending`（券商状态未知），Node 侧会直接返回“需人工核对”，不会再次发单。
- **回执超时 ≠ 没成交**：Node 等回执超时（默认 10s）→ 自动 `halt` + ticket 留 `pending`，**不当成交、不自动重下**，需人工核对。所以后端对每个请求**务必回一条回执**（成/拒），即使慢也要回。
- **异常成交回执按未知状态处理**：后端如果返回 `filled` 但缺少有效 `filledPrice/filledQty`、成交量超过请求量，或成交价高于请求限价，Node 侧会 `halt` + ticket 留 `pending`，不记成本地成交，也不改成 rejected，需人工核对券商真实状态。
- **崩溃**：子进程退出 → Node 把所有在途请求判为失败 + halt。
- **总闸**：下单前已过 Node 侧确定性 Risk Gate（单日亏损/笔数/金额/黑名单/涨停不追/资金持仓校验）。后端不需重复校验，但可加券商侧校验。

## 开启 live（默认关）

真盘开关在 **环境变量**（部署级，不入 db/UI，防误触发真钱）：

```bash
export LUMOS_MESH_ENABLE_LIVE=1            # 真盘总闸，默认关
export LUMOS_MESH_TRADE_MODE=live          # paper(默认) | live；live 需总闸也开才生效
export LUMOS_MESH_LIVE_BACKEND=/path/to/qmt_trade_backend.py   # live 必填；不配置不进入 live
```

三个条件都满足（`ENABLE_LIVE=1`、`TRADE_MODE=live`、`LUMOS_MESH_LIVE_BACKEND` 指向真实脚本）才会走真盘；任一没开 → 仍是 paper 或明确拒绝。内置 mock 只用于显式 IPC / 集成测试，不作为生产 live 的默认后端。

## Windows 接国金 qmt（你来做 + L2 验）

1. 按上面协议写 `qmt_trade_backend.py`：循环读 stdin 行 → `place_order` → 调 qmt 下单 API → 把券商回执按协议格式写 stdout。启动先 `print({"type":"ready"})`。
2. 参考 mac mock：`resources/mcp-servers/mesh-trade/mock_trade_backend.py`（同协议，回固定 filled）。
3. 用 qmt 自带 Python（`C:\Python311\python.exe` 或国金客户端绑定的）；`LUMOS_MESH_LIVE_BACKEND` 指向你的脚本。
4. **L2 真验**：先用最小一手、限价单、盘后或模拟环境验证回执链路通；确认 ticket filled + 账户记账 + 幂等不重下，再上实盘。
5. 出任何异常（超时/拒/崩溃）Node 侧会自动 halt——查 `mesh_paper_account.halted` 和 ticket 状态，人工核对券商实际成交后再解除。
