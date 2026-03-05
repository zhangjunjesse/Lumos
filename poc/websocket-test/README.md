# WebSocket 技术验证 POC

## 目标

验证 WebSocket 在 Electron 环境中连接飞书开放平台的稳定性。

## 测试内容

1. **长连接稳定性**：保持连接 24 小时
2. **断线重连**：模拟网络中断后的自动重连
3. **消息收发**：记录消息延迟和吞吐量
4. **错误处理**：记录所有错误和异常

## 使用方法

### 1. 安装依赖

```bash
cd poc/websocket-test
npm install
```

### 2. 配置飞书应用

在飞书开放平台创建应用，获取 `app_id` 和 `app_secret`。

### 3. 运行测试

```bash
export FEISHU_APP_ID="your_app_id"
export FEISHU_APP_SECRET="your_app_secret"
npm test
```

### 4. 长时间测试

```bash
# 后台运行 24 小时
nohup npm test > test.log 2>&1 &

# 查看日志
tail -f test.log
```

## 测试指标

- **连接时长**：目标 >24 小时
- **重连成功率**：目标 >95%
- **消息延迟**：目标 <1 秒
- **错误率**：目标 <5%

## 输出报告

测试完成后，查看 `test.log` 中的统计数据，包括：
- 总运行时间
- 消息接收数量
- 断线重连次数
- 错误日志

## 风险评估

根据测试结果评估：
- ✅ Go：重连成功率 >95%，可以继续实施
- ⚠️ Caution：重连成功率 80-95%，需要优化重连策略
- ❌ No-Go：重连成功率 <80%，考虑替代方案（Webhook/长轮询）
