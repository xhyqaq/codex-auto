# codex-auto 默认账号引导与默认起始账号设计

日期：2026-04-18
状态：draft

## 1. 概述

当前 `codex-auto` 要求用户先显式执行 `codex-auto add <name>`，并且默认启动账号由轮转指针 `currentIndex` 决定。这两个行为都偏内部实现，不符合首次使用和日常使用的直觉：

- 用户通常已经在原始 `CODEX_HOME` 中登录过一个可用账号，不应再被迫手工补一次 `add`
- 用户希望指定“以后默认先用哪个账号”，而不是每次都从上一次轮转停下的位置重新开始

本次设计引入两项产品行为：

1. 首次使用自动从源 `CODEX_HOME` 引导一个名为 `default` 的账号
2. 支持持久保存一个“默认起始账号”，并在每次裸跑 `codex-auto` 时优先从该账号开始

## 2. 目标与非目标

### 2.1 目标

- 首次运行 `codex-auto` 时，如果本地已有可用 Codex 登录态，则无需先执行 `add`
- 把自动引导出的账号稳定命名为 `default`
- 支持用户显式设置长期生效的默认起始账号
- 保持 `--account <name>` 作为单次运行覆盖，不污染长期偏好
- 保留现有额度检测、自动切号、会话恢复、overlay `CODEX_HOME` 架构
- 让 `list` 能同时表达“默认起始账号”和“当前轮转指针”

### 2.2 非目标

- 不做账号权重、优先级分组或健康评分
- 不根据“上次成功账号”自动改写用户默认偏好
- 不新增交互式向导；首次引导保持无感
- 不在本次设计中重做账号排序模型

## 3. 用户体验设计

### 3.1 首次使用自动引导

当用户第一次运行 `codex-auto` 或任何受管透传命令时，如果满足以下条件：

- `state.json` 中没有任何账号
- 源 `CODEX_HOME/auth.json` 存在且非空

则程序自动完成一次引导：

- 创建账号 `default`
- 复制源 `CODEX_HOME/auth.json` 到 `accounts/default/auth.json`
- 如果源 `CODEX_HOME/config.toml` 存在，则一并复制到 `accounts/default/config.toml`
- 将 `default` 写入账号列表
- 将默认起始账号设为 `default`

程序可以输出一行轻提示，说明已自动引导 `default`，但不应要求用户额外确认。

### 3.2 默认起始账号

新增命令：

```bash
codex-auto use <name>
```

行为：

- 将 `<name>` 持久保存为默认起始账号
- 只影响后续默认启动行为，不改变账号列表顺序
- 不改变本次运行外的轮转结果

### 3.3 启动优先级

默认启动账号选择顺序为：

1. 若传入 `--account <name>`，使用该账号，仅影响本次运行
2. 否则，若存在默认起始账号，使用该账号
3. 否则，回退到 `currentIndex`
4. 若仍无法解析，则回退到账号列表第一个

这样可以把“用户偏好”和“运行态轮转位置”明确分离。

### 3.4 列表展示

`codex-auto list` 继续输出账号列表，但增加默认起始账号标记。

建议格式：

```text
* default (default)
  work
  backup
```

语义：

- `*` 表示当前轮转指针 `currentIndex`
- `(default)` 表示默认起始账号

如果两者落在不同账号上，应同时显示，让用户理解“默认从谁开始”和“系统当前轮转停在哪里”是两个不同概念。

## 4. 状态设计

`state.json` 新增字段：

```json
{
  "version": 1,
  "accounts": ["default", "work", "backup"],
  "currentIndex": 1,
  "preferredAccountName": "work",
  "lastSuccessfulAccount": "work",
  "lastSessionId": "session-123",
  "updatedAt": "2026-04-18T10:00:00.000Z"
}
```

字段语义：

- `accounts`
  轮转顺序
- `currentIndex`
  当前轮转指针，由运行态推进
- `preferredAccountName`
  用户设置的默认起始账号
- `lastSuccessfulAccount`
  最近一次成功运行结束的账号

归一化规则：

- 若账号列表为空，`currentIndex` 必须为 `null`，`preferredAccountName` 必须为 `null`
- 若 `preferredAccountName` 不再存在于账号列表中，应在加载或删除账号时自动修正
- 旧状态文件没有 `preferredAccountName` 时，按 `null` 兼容

## 5. CLI 契约

### 5.1 `codex-auto`

行为更新：

- 当无账号但存在源 `CODEX_HOME/auth.json` 时，自动引导 `default`
- 引导后继续本次会话，不要求用户重试
- 默认启动时优先使用 `preferredAccountName`

### 5.2 `codex-auto add <name>`

行为保持不变，但状态规则补充为：

- 若这是系统中的第一个账号，则自动把它设为默认起始账号
- 若系统已有默认起始账号，则新增账号不会覆盖该偏好

### 5.3 `codex-auto use <name>`

新增命令，行为如下：

- `<name>` 不存在时报错
- 成功后更新 `preferredAccountName`
- 输出明确结果，例如 `Default start account set to <name>`

### 5.4 `codex-auto remove <name>`

删除默认起始账号时：

- 若删除后仍有账号，则把 `preferredAccountName` 回退到账号列表第一个
- 若删除后没有账号，则设为 `null`

删除非默认账号时：

- 保持现有默认起始账号不变

## 6. 数据流与实现边界

### 6.1 首次引导流程

受管运行入口在真正读取账号状态前执行：

1. 检查 `state.json` 是否已有账号
2. 若没有，则检查源 `CODEX_HOME/auth.json`
3. 若源认证存在，则自动创建 `accounts/default/`
4. 复制源认证与可选配置
5. 初始化 `state.json`
6. 继续正常启动流程

这一流程只在“当前没有任何账号”时触发，避免覆盖显式管理过的账号集。

### 6.2 运行时选择

`runManagedSession` 不再只依赖 `currentIndex` 选择起始账号，而是先解析：

- `preferredAccountName`
- `--account`

但额度触发后的轮转仍按现有 `accounts` 顺序和 `pickNextAccount` 逻辑执行。

### 6.3 轮转成功后的状态

运行中发生自动切号并成功恢复后：

- 更新 `currentIndex`
- 更新 `lastSuccessfulAccount`
- 不自动改写 `preferredAccountName`

这样用户对“默认从谁开始”的控制权始终稳定。

## 7. 错误处理

- 首次自动引导时，如果源 `auth.json` 不存在、为空或复制失败，则保持现状，不创建半成品 `default`
- 自动引导失败后，仍输出当前的“无账号”提示，引导用户手动 `add`
- `use <name>` 指向不存在账号时，报错并返回非零退出码
- 自动引导只允许发生在当前账号列表为空时，避免与已有 `default` 命名冲突

## 8. 测试策略

自动化测试至少覆盖：

- 无账号时自动引导 `default`
- 自动引导会复制源 `auth.json`，并在存在时复制 `config.toml`
- 默认启动优先使用 `preferredAccountName`
- `--account` 优先级高于 `preferredAccountName`
- `use <name>` 能持久保存默认起始账号
- 删除默认起始账号后的回退规则
- `list` 能同时标出轮转指针和默认起始账号

文档更新至少覆盖：

- README 增加首次自动引导 `default`
- README 增加设置默认起始账号的使用说明
- 文案保持产品介绍口径，不把内部状态字段直接写成卖点

## 9. 风险与权衡

- 自动引导 `default` 会让“账号从零开始为空”的状态更少见，但显著改善首次体验
- `preferredAccountName` 与 `currentIndex` 并存会增加一点状态复杂度，但换来稳定、可解释的用户语义
- 保留 `--account` 作为一次性覆盖，可以兼顾脚本场景和长期偏好场景
