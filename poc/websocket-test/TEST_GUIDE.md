# WebSocket 技术验证测试指南

## 测试前准备

### 1. 获取飞书应用凭证

访问 [飞书开放平台](https://open.feishu.cn/app) 创建测试应用：

1. 登录飞书开放平台
2. 创建企业自建应用
3. 获取 `App ID` 和 `App Secret`
4. 开启"事件订阅"权限
5. 添加机器人能力

### 2. 安装依赖

```bash
cd /Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/poc/websocket-test
npm install
```

## 测试执行

### 测试 1：Node.js 环境（快速验证）

**目的**：验证基础连接和重连逻辑

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
npm test
```

**预期结果**：
- 成功连接到飞书 WebSocket
- 每分钟输出统计信息
- Ctrl+C 退出时显示最终报告

**测试时长**：30 分钟

### 测试 2：断线重连测试

**步骤**：
1. 启动测试：`npm test`
2. 等待连接成功（看到 "Connected" 日志）
3. 断开网络（关闭 Wi-Fi 或拔网线）
4. 等待 30 秒
5. 恢复网络
6. 观察重连行为

**验收标准**：
- ✅ 自动检测到断线
- ✅ 开始重连（看到 "Reconnecting" 日志）
- ✅ 成功重连（看到 "Connected" 日志）
- ✅ 重连时间 < 30 秒

### 测试 3：24 小时稳定性测试

**步骤**：
```bash
# 后台运行
nohup npm test > test-24h.log 2>&1 &

# 记录进程 ID
echo $! > test.pid

# 查看实时日志
tail -f test-24h.log
```

**监控指标**：
```bash
# 每小时检查一次
grep "Stats" test-24h.log | tail -1
```

**停止测试**：
```bash
kill $(cat test.pid)
```

**验收标准**：
- ✅ 运行时长 > 24 小时
- ✅ 断线次数 < 10
- ✅ 重连成功率 > 95%
- ✅ 无致命错误

## 测试结果分析

### 1. 提取关键数据

```bash
# 总运行时间
grep "Uptime" test-24h.log | tail -1

# 消息总数
grep "Messages" test-24h.log | tail -1

# 断线次数
grep "Disconnects" test-24h.log | tail -1

# 错误次数
grep "Errors" test-24h.log | tail -1
```

### 2. 计算成功率

```bash
# 重连成功率 = (断线次数 - 错误次数) / 断线次数 * 100%
```

### 3. 填写报告

使用 `REPORT_TEMPLATE.md` 填写测试结果。

## 常见问题

### Q1: 连接失败 "401 Unauthorized"
**原因**：App ID 或 App Secret 错误
**解决**：检查环境变量是否正确

### Q2: 连接失败 "403 Forbidden"
**原因**：应用未开启事件订阅权限
**解决**：在飞书开放平台开启权限

### Q3: 频繁断线
**原因**：网络不稳定或飞书服务端问题
**解决**：更换网络环境或联系飞书技术支持

### Q4: 无法接收消息
**原因**：应用未添加到群组
**解决**：创建测试群组并添加机器人

## 下一步

测试完成后：
1. 填写 `REPORT_TEMPLATE.md`
2. 分析测试数据
3. 评估风险等级
4. 给出 Go/No-Go 建议
