# IM Module — `core/`

> **改这一层之前必须读完本文件 + `docs/im-module-design.md`。**
> 这层是所有 provider 的共享契约，错一行就连锁炸 N 个 provider。

## 这一层是什么

```
core/
├── types.ts          ★ 契约：IMAdapter（必选）+ P1 mixins + Manifest + Plugin
├── types-future.ts   P2 预留接口（M1-M5 不实现）
├── registry.ts       静态插件注册中心
├── config-store.ts   Settings 命名空间统一读写（im.<id>.*）
├── runtime.ts        运行态 adapter 实例 + 出站发送入口
└── README.md         (你正在看)
```

## 9 条硬规则（速查）

完整规则见 `docs/im-module-design.md` §2。下面列出本层最容易踩坑的 5 条：

1. **types.ts 是唯一跨边界类型源**：改它要全 provider 回归测试。
2. **registry 不读 settings**：启用/默认状态一律走 config-store。
3. **runtime 不持久化**：重启后从 config-store + registry 重建。
4. **静态注册零反射**：禁止 `fs.readdirSync` / glob / 动态 import provider。
5. **依赖单向**：`providers/* → core/types`，不允许 `core/* import providers/*`。

## 修改本层的检查清单

- [ ] 是不是真的需要改 core？能不能在 provider 内部解决？
- [ ] 改 types.ts 的话，已有 provider（feishu/wechat-qclaw/wechat-work）是否仍然能编译过？
- [ ] 是否给新增字段写了默认值或 optional 标记？避免破坏老配置数据。
- [ ] config-store 加了新 key namespace 吗？写入 `docs/im-module-design.md` §3。
- [ ] runtime 加了新副作用吗？是否能 `__resetRuntimeForTesting` 清掉？
- [ ] 单元测试在哪？（core 没有 `__tests__/`，要建。）

## 不要做的事

- ❌ 把 provider-specific 的逻辑塞进 core（"飞书需要这个字段所以 core 加一下" → 错）
- ❌ 引入 EventEmitter 取代显式函数调用（M1 有意不做事件总线，需要时再讨论）
- ❌ 在 registry 或 config-store 里 catch 异常吞掉（要么抛要么返回明确 error）
- ❌ 加 default 参数让 API "更好用"（参数膨胀会让 AI 改不动）

## 给后续 AI 的"读文件顺序"

如果你要在 core/ 改东西：
1. 先读 `docs/im-module-design.md`（架构总览）
2. 再读 `core/types.ts`（理解契约）
3. 看 `providers/feishu/manifest.ts`（看一个真实 provider 怎么用 contract）
4. 才动手改

如果你要新增一个 provider：**别读 core/**。复制 `providers/feishu/` 改名、改 manifest，最后改 `src/lib/im/index.ts` 加一行 register。
