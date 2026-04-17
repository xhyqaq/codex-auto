# codex-auto 设计文档

日期：2026-04-17
状态：draft

## 1. 概述

`codex-auto` 是一个 macOS 终端 CLI，用来托管原生 `codex` 会话，并在当前账号明确出现额度或限流错误时，按预设顺序切换到下一个账号，随后恢复同一个 Codex 会话并自动发送 `继续`。

第一版聚焦四个能力：

- `codex-auto`：直接进入受管对话
- `codex-auto list`：查看账号列表和当前轮换位置
- `codex-auto add <name>`：创建并登录一个新账号
- `codex-auto remove <name>`：删除一个账号，即使它是最后一个账号
- `codex-auto --account <name>`：指定本次启动优先使用某个账号

## 2. 目标与非目标

### 2.1 目标

- 支持多个 Codex 账号的顺序轮换管理
- 允许用户通过 `add` 完成新账号接入，不要求手工拷贝认证文件
- 仅在明确识别到额度或限流类错误时自动切账号
- 切账号后继续同一个会话，而不是新建线程
- 恢复会话后自动补发 `继续`，避免用户手动确认
- 不改写用户现有 `~/.codex`，所有受管状态都放在 `~/.codex-auto`

### 2.2 非目标

- 不支持 Windows 或 Linux
- 不做 GUI，不做 TUI 重写
- 不处理“网络故障、权限错误、登录失效”等非额度问题的自动切换
- 不做账号优先级、主备分组或权重调度
- 不做协议级 app-server 接入，第一版只做 PTY 托管

## 3. 外部约束

以下事实基于 2026-04-17 当天的官方文档和本机 `codex-cli 0.121.0` 实测。

### 3.1 官方文档约束

- Codex 用户级配置默认位于 `~/.codex/config.toml`，CLI 支持 `--profile <name>` 从该文件读取 profile。
- CLI 支持 `codex resume --last` 恢复当前工作目录最近一次交互会话，并允许附加一个恢复后的首条 prompt。
- Codex 的认证缓存默认可位于 `~/.codex/auth.json`，也可能位于系统 keyring；配置 `cli_auth_credentials_store = "file"` 时会使用 `CODEX_HOME` 下的 `auth.json`。
- 文件型认证缓存是敏感信息，必须像密码一样处理。

### 3.2 本机 CLI 约束

- 本机安装版本为 `codex-cli 0.121.0`
- `codex --help` 暴露了 `--profile`、`--no-alt-screen`、`resume`、`login`
- `codex resume --help` 确认支持 `--last` 和恢复后附带 prompt
- 原生二进制字符串中可见 `CODEX_HOME`、`auth.json`、`session_index.jsonl` 等路径标识
- 二进制字符串中可见 `usageLimitExceeded`、`rateLimits` 等错误/事件标识

### 3.3 由约束推导出的设计判断

- “多账号”不能简单等价为一个 `config.toml` 里多个 profile，因为 profile 不能替代独立认证缓存
- “整套 `CODEX_HOME` 一账号一份”也不能直接用于运行态，否则 `resume --last` 无法稳定接到同一受管会话
- 因此必须拆分为“共享 runtime 会话状态”与“账号私有认证/配置状态”

## 4. 总体架构

`codex-auto` 采用 Node.js + TypeScript 实现，作为原生 `codex` 的前台包装器运行。

架构拆为三层：

1. 账号管理层
- 维护账号列表、轮换顺序、当前游标
- 提供 `list/add/remove`

2. 运行编排层
- 在受管会话开始前，把目标账号的认证与配置同步到共享 runtime
- 在额度耗尽时选出下一个账号并重建运行上下文
- 负责执行 `codex resume --last "继续"`

3. 终端托管层
- 通过 PTY 启动原生 `codex`
- 透传 stdin/stdout/stderr
- 监控输出中的额度耗尽信号

## 5. 目录与状态设计

所有受管状态存放在 `~/.codex-auto/`。

### 5.1 共享 runtime

路径：`~/.codex-auto/runtime/`

用途：

- 作为受管 `codex` 进程的 `CODEX_HOME`
- 保存会话连续性所需的共享文件

预期包含：

- `session_index.jsonl`
- `sessions/`
- `history.jsonl`
- `state_*.sqlite`
- `logs_*.sqlite`
- `auth.json`
- `config.toml`

规则：

- 会话相关文件始终保留在 runtime 中，不因账号切换而清空
- `auth.json` 与 runtime 级 `config.toml` 会在切换账号时被覆盖为目标账号对应内容

### 5.2 账号私有目录

路径：`~/.codex-auto/accounts/<name>/`

用途：

- 保存该账号的独立认证缓存和账号级配置

预期包含：

- `auth.json`
- `config.toml`
- `meta.json`

说明：

- 第一版要求 `add` 后的账号使用文件型凭据缓存，避免依赖系统 keyring 导致账号切换无法编排
- `meta.json` 保存展示用途的非敏感元信息，例如账号名、创建时间、最后一次使用时间

### 5.3 全局状态文件

路径：`~/.codex-auto/state.json`

建议结构：

```json
{
  "version": 1,
  "accounts": ["a", "b", "c"],
  "currentIndex": 0,
  "lastSuccessfulAccount": "a",
  "updatedAt": "2026-04-17T10:00:00.000Z"
}
```

规则：

- `accounts` 的顺序就是轮换顺序
- `currentIndex` 指向默认启动账号
- 当账号列表为空时，`currentIndex` 为 `null`
- 所有写入必须使用原子替换

## 6. CLI 契约

### 6.1 `codex-auto`

行为：

- 如果没有账号，直接报错并提示先执行 `codex-auto add <name>`
- 如果有账号，使用 `state.json` 当前游标对应的账号启动受管会话
- 若传入 `--account <name>`，则本次运行优先使用该账号启动
- 会话中若检测到额度耗尽，则自动轮换到下一个账号

### 6.2 `codex-auto list`

行为：

- 输出账号顺序
- 输出当前游标位置
- 输出每个账号的名字
- 不输出敏感凭据

### 6.3 `codex-auto add <name>`

行为：

- 创建 `~/.codex-auto/accounts/<name>/`
- 写入该账号的最小 `config.toml`
- 在该账号目录上下文中执行 `codex login`
- 登录成功且认证缓存落盘后，将该账号追加到轮换列表末尾

失败处理：

- 若登录失败或认证缓存不存在，回滚此次 `add`
- 不把半成品账号写进 `state.json`

### 6.4 `codex-auto remove <name>`

行为：

- 从 `state.json` 移除该账号
- 删除其私有目录
- 允许删除最后一个账号

状态修正：

- 若删除后列表为空，则把 `currentIndex` 设为 `null`
- 若删除的是当前游标项，则将游标移动到删除后同位置可用账号，若不存在则回到 0；空列表除外

## 7. 账号接入策略

`add` 命令必须显式把该账号配置为文件型认证缓存，以便 `codex-auto` 能管理账号切换。

建议写入的最小账号级 `config.toml`：

```toml
cli_auth_credentials_store = "file"
```

如果后续需要账号级差异配置，可继续放在该账号自己的 `config.toml` 中，例如 model、approval policy、sandbox mode，但第一版不要求提供独立的 profile 管理 UI。

## 8. 受管运行流程

### 8.1 启动阶段

1. 读取 `state.json`
2. 选择当前游标账号
3. 用该账号的 `auth.json` 覆盖 runtime 的 `auth.json`
4. 用 runtime 基础模板与账号专属配置合成 runtime 的 `config.toml`
5. 以 `CODEX_HOME=~/.codex-auto/runtime` 启动原生 `codex`
6. 默认追加 `--no-alt-screen`，以提高 PTY 输出可观测性

### 8.2 正常对话阶段

- 用户输入直接透传给原生 `codex`
- `codex-auto` 只做日志缓冲和额度错误识别，不改写普通交互内容

### 8.3 切换阶段

当检测到明确额度/限流错误时：

1. 把当前账号加入“本次会话已耗尽账号集合”
2. 正常终止当前 `codex` 进程
3. 按顺序选择下一个未在本次会话中耗尽的账号
4. 用新账号覆盖 runtime 中的认证与账号级配置
5. 执行 `codex resume --last "继续"`
6. 若再次命中额度错误，重复上述流程

### 8.4 全部耗尽

如果本次会话中的所有账号都已被判定为耗尽：

- 退出受管会话
- 打印明确提示，说明所有账号都已耗尽

## 9. 会话连续性设计

核心要求是“同一个会话继续”，不是“切到新账号后再新建一个会话”。

为实现这一点：

- 运行态始终只使用一个共享 runtime `CODEX_HOME`
- 只在账号切换时替换 runtime 的认证与账号级配置
- runtime 的会话索引和历史文件保持不变
- 恢复命令统一使用 `codex resume --last "继续"`

这个设计依赖两个条件：

- `resume --last` 仍然能在共享 runtime 中找到上一条线程
- 恢复附带 prompt 能把 `继续` 作为首条用户消息发出去

如果后续实测发现 `--last` 在极端情况下不稳定，可以退化为记录并使用显式 `SESSION_ID` 恢复，但第一版先不增加这层复杂度。

## 10. 错误识别策略

### 10.1 触发自动切换的错误

仅在明确出现以下类别错误时触发切换：

- `usage limit exceeded`
- `usageLimitExceeded`
- `rate limit reached`
- `quota exceeded`
- `limit reached`
- 含义等价的中文额度耗尽/限流提示

第一版采用双保险：

- 运行中的实时输出文本匹配
- 进程失败退出后的末尾缓冲区匹配

### 10.2 明确不触发切换的错误

- 网络连接失败
- 登录失效
- 权限或 sandbox 错误
- 工作区命令失败
- 用户主动退出

设计原则是只在“当前账号明确不能继续消费”时切换，避免误把瞬时故障当作额度耗尽。

## 11. 配置合成与文件同步规则

### 11.1 runtime `config.toml`

runtime 的 `config.toml` 由两部分组成：

- `codex-auto` 自己控制的稳定基础配置
- 当前账号的账号级配置

第一版基础配置包含：

- `cli_auth_credentials_store = "file"`

运行参数层面默认附加：

- `--no-alt-screen`

后续如果用户要求，也可以增加 `codex-auto config` 一类命令来管理运行时基础设置，但第一版不做。

### 11.2 同步规则

每次切换账号时，仅同步：

- `accounts/<name>/auth.json` -> `runtime/auth.json`
- `accounts/<name>/config.toml` -> 参与生成 `runtime/config.toml`

绝不覆盖：

- `runtime/session_index.jsonl`
- `runtime/sessions/`
- `runtime/history.jsonl`
- `runtime/state_*.sqlite`

## 12. 可靠性设计

### 12.1 原子写入

以下文件使用临时文件 + rename 原子替换：

- `state.json`
- `runtime/config.toml`
- `runtime/auth.json`
- `accounts/<name>/meta.json`

### 12.2 单实例锁

第一版增加一个运行锁文件，例如：

- `~/.codex-auto/runtime/.lock`

目的：

- 避免两个 `codex-auto` 同时操作同一个共享 runtime
- 避免两个会话互相覆盖 runtime 里的认证与配置

如果已有活跃锁，则新的 `codex-auto` 直接失败并提示已有受管会话运行中。

### 12.3 日志

建议保存受管日志到：

- `~/.codex-auto/logs/`

至少记录：

- 启动账号
- 切换发生时间
- 触发切换的识别信号
- 恢复命令结果
- 会话最终退出原因

日志中不得打印完整 token 或 `auth.json` 内容。

### 12.4 目录权限

创建账号目录和 runtime 目录时，权限收紧为当前用户可读写，避免凭据外泄。

## 13. 技术选型

建议栈：

- Node.js 20+
- TypeScript
- `commander`：命令解析
- macOS `script`：交互式 PTY 托管
- 普通 shell 子进程：非交互测试回退路径
- `zod` 或等价库：`state.json` / `meta.json` 校验

不推荐第一版使用 shell 脚本主导实现，因为 PTY 管理、跨步骤错误恢复和原子状态写入会变得脆弱。

实现说明：

- 初版实现曾尝试 `node-pty`，但在当前 macOS 环境中无法稳定启动，因此改为系统 `script` 作为交互式 PTY 托管手段

## 14. 测试策略

### 14.1 单元测试

覆盖：

- `state.json` 读写与 schema 校验
- `currentIndex` 修正逻辑
- `remove` 删除当前项和最后一项
- 本次会话耗尽账号集合的轮换逻辑
- 额度错误文本识别

### 14.2 集成测试

使用一个 fake `codex` 可执行文件模拟：

- 第一次运行输出额度耗尽错误并退出
- 第二次运行接受 `resume --last "继续"` 并正常继续

验证：

- `codex-auto` 能触发切换
- 能正确替换 runtime 认证
- 能执行恢复命令
- 能把 `继续` 作为恢复后 prompt 发出

### 14.3 手工验收

验收场景：

- `add/list/remove` 全流程
- 单账号正常对话
- 双账号下自动切换
- 所有账号耗尽时退出提示
- 删除最后一个账号后，裸 `codex-auto` 的报错提示

## 15. 已知风险与缓解

### 风险 1：`--no-alt-screen` 仍不足以覆盖所有额度报错表现

缓解：

- 保留最后 N 行输出缓冲区用于退出后补判
- 错误匹配词表集中管理并可扩展

### 风险 2：部分环境默认使用 keyring 而非文件认证缓存

缓解：

- `add` 时强制该账号目录使用 `cli_auth_credentials_store = "file"`
- 登录完成后检查 `auth.json` 是否存在，不存在则判定 `add` 失败

### 风险 3：`resume --last` 依赖当前工作目录作用域

缓解：

- `codex-auto` 启动和恢复时始终传递一致的工作目录
- 若后续实测需要，可在第二版显式保存 `SESSION_ID`

### 风险 4：多个会话同时运行导致 runtime 状态互相覆盖

缓解：

- 第一版直接禁止多实例共享同一个 runtime

## 16. 分阶段实现建议

### 第一阶段

- 状态目录初始化
- `list/add/remove`
- 最小运行锁

### 第二阶段

- PTY 托管 `codex-auto`
- runtime 认证同步
- 自动切换与 `resume --last "继续"`

### 第三阶段

- 日志完善
- fake `codex` 集成测试
- 边界问题修正

## 17. 参考

官方文档：

- Config Basics: https://developers.openai.com/codex/config-basic
- Authentication: https://developers.openai.com/codex/auth
- Command Line Options: https://developers.openai.com/codex/cli/reference

关键依据：

- Config Basics 说明用户级配置默认位于 `~/.codex/config.toml`，且 `--profile` 从该文件加载 profile
- Authentication 说明认证缓存可位于 `auth.json` 或系统凭据存储，且文件模式下位于 `CODEX_HOME`
- Command Line Options 说明 `codex resume` 支持 `--last` 和恢复后的 follow-up prompt，且 `--no-alt-screen` 可关闭 alternate screen
