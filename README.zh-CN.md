# codex-auto

[English](./README.md) | 中文

`codex-auto` 是一个给 `codex` CLI 用的多账号切换器。

它把账号认证保存在 `~/.codex-auto/accounts/`，基于你现有的 Codex 使用方式启动受管会话；当前账号命中额度限制时，会自动切到下一个账号并继续恢复会话。

## 适用场景

- 你有多个可用的 Codex 账号
- 不想手动改 `auth.json`、`config.toml`
- 希望额度耗尽后自动切号并恢复会话
- 希望继续复用原始 Codex 的会话历史、插件和 MCP 配置

## 当前能力

- 管理多套账号配置
- 首次添加账号时直接跑 `codex login`
- 首次运行时可从现有 Codex 登录态自动引导 `default` 账号
- 支持导入现成的 `auth.json` 和 `config.toml`
- 启动受管 `codex` 会话
- 交互模式保持接近日常终端里的 Codex 使用体验
- 支持保存长期生效的默认起始账号
- 命中额度限制后自动切到下一个账号
- 列表中可显示仍在等待恢复额度的账号及其恢复时间
- 每个活跃受管会话都会绑定自己的恢复目标，支持同项目和跨项目并发运行
- 切号时只恢复当前受管会话已绑定的 session id，不会改用别的终端里的最新会话
- 如果无法确认原会话或绑定的 session id 已失效，会停止自动恢复而不是猜测恢复目标
- 恢复时自动补发 `Continue`
- 记录运行日志和状态文件
- 透传所有 `codex` 原始参数和子命令（如 `exec`、`review`、`--model`、`--full-auto`）

## 前置要求

- Node.js 18+
- 本机已安装可执行的 `codex` CLI
- `codex` 可以正常执行 `codex login`、`codex resume`

## 安装

推荐安装方式：

```bash
npm install -g codex-auto
```

安装后验证：

```bash
codex-auto --help
```

升级到最新版本：

```bash
npm install -g codex-auto@latest
```

卸载：

```bash
npm uninstall -g codex-auto
```

如果你是本地开发这个仓库，再使用下面这套方式：

```bash
npm install
npm run build
npm link
```

## 快速开始

直接启动受管会话：

```bash
codex-auto
```

第一次运行时，如果源 `CODEX_HOME` 里已经有可用登录态，`codex-auto` 会自动把它导入为 `default` 账号。

继续添加更多账号：

```bash
codex-auto add a
codex-auto add b
```

查看账号列表：

```bash
codex-auto list
```

如果某个账号仍在等待额度恢复，`codex-auto list` 会把 Codex 给出的恢复时间显示在该账号后面。

启动受管会话：

```bash
codex-auto
```

从指定账号启动：

```bash
codex-auto --account b
```

设置之后默认优先使用的账号：

```bash
codex-auto use b
```

使用自定义原始 `CODEX_HOME` 启动：

```bash
codex-auto --codex-home /path/to/.codex
```

删除账号：

```bash
codex-auto remove b
```

## 透传 codex 参数

除了 `codex-auto` 自身的命令（`add`、`remove`、`list`），其余参数全部原样转发给 `codex`：

```bash
# 传入 prompt
codex-auto "修复登录 bug"

# 指定模型
codex-auto --model o3 "重构 auth 模块"

# 非交互 exec 模式
codex-auto exec "添加单元测试"

# 指定账号 + full-auto
codex-auto --account b --full-auto "迁移到 TypeScript"

# 代码审查
codex-auto review
```

所有透传调用都保留多账号轮转能力：当前账号命中额度限制时，自动切到下一个账号并恢复。

`--account <name>` 只影响当前这一次运行；`codex-auto use <name>` 会修改后续默认启动时优先使用的账号。

## 导入已有配置

如果你已经有现成的账号目录，可以直接导入：

```bash
codex-auto add work --auth /path/to/auth.json --config /path/to/config.toml
```

规则是：

- `--auth` 导入账号凭据
- `--config` 导入账号配置
- 如果没有提供 `--auth`，会自动执行一次 `codex login`
- `config.toml` 会至少保证包含 `cli_auth_credentials_store = "file"`

## 工作方式

`codex-auto` 会维护一个自己的目录，默认在：

```bash
~/.codex-auto
```

目录结构大致如下：

```text
~/.codex/                  # 你的原始 Codex home，不会被改写
├── auth.json
├── config.toml
├── sessions/
└── ...

~/.codex-auto/
├── accounts/
│   ├── a/
│   │   ├── auth.json
│   │   ├── config.toml
│   │   └── meta.json
│   └── b/
├── instances/
│   └── <timestamp-pid-uuid>/
│       ├── auth.json
│       ├── config.toml -> ~/.codex/config.toml
│       ├── session_index.jsonl -> ~/.codex/session_index.jsonl
│       ├── sessions -> ~/.codex/sessions
│       └── ...
├── logs/
├── runs/
│   └── <run-id>.json
└── state.json
```

其中：

- `accounts/<name>/` 保存每个账号自己的认证与配置
- `instances/<id>/` 是每次运行临时创建并在切号时复用的 overlay `CODEX_HOME`
- `runs/<run-id>.json` 保存当前受管进程自己的账号、session 绑定和恢复状态
- `state.json` 保存账号顺序、当前索引、默认起始账号、上次成功账号、最近一次成功绑定的 session id
- `logs/` 保存会话日志和终端 transcript

每次受管运行时，`codex-auto` 都会创建 `~/.codex-auto/instances/<id>/`，把原始 `CODEX_HOME` 中的条目符号链接进去，只把 `auth.json` 替换成当前账号的真实副本，然后在这次受管运行期间持续复用同一个 overlay。命中额度限制后只替换 overlay 里的 `auth.json` 再恢复原会话，进程退出后 overlay 会被清理，因此会话历史、插件、MCP 配置等仍然保留在原始 home 里。

交互式会话会尽量保持你平时使用 Codex 时的终端体验，包括全屏和分屏场景；同时 `codex-auto` 仍然会在后台监控输出并在额度触发时自动切号、恢复会话。

## 切号与恢复逻辑

当前版本只在检测到真实的额度耗尽提示时触发切号，避免把提醒类文案误判成失败。

命中额度限制后：

1. 标记当前账号已耗尽
2. 切换到下一个可用账号
3. 在当前受管进程的 overlay 里替换为下一个账号的 `auth.json`
4. 只使用当前受管进程已经绑定的 session id 恢复原会话
5. 执行：

```bash
codex resume <session-id> Continue
```

如果这次运行还没有安全绑定到自己的 session id，或者该 session id 已失效，`codex-auto` 会停止自动恢复并提示人工处理，而不是回退到 `codex resume --last` 去猜测恢复目标。

为了避免历史 transcript 干扰，恢复场景下只有最新 prompt 之后的新输出才会参与额度检测。

并发运行说明：

- 同一个项目下在多个终端同时运行多个 `codex-auto` 时，每个活跃进程都会维护自己的 session 绑定
- 不同项目下在多个终端同时运行多个 `codex-auto` 时，也会按各自进程分别恢复
- 自动切号的恢复目标始终按“当前活跃受管进程”决定，而不是按项目级或全局最新会话决定

## 环境变量

- `CODEX_AUTO_HOME`
  指定 `codex-auto` 的数据目录，默认是 `~/.codex-auto`

- `CODEX_HOME`
  指定作为 overlay 基底的原始 Codex home，默认是 `~/.codex`

- `CODEX_AUTO_CODEX_BIN`
  指定底层 `codex` 可执行文件路径，默认是 `codex`

示例：

```bash
CODEX_AUTO_HOME=/tmp/codex-auto \
CODEX_HOME=/Users/me/.codex \
CODEX_AUTO_CODEX_BIN=/opt/homebrew/bin/codex \
codex-auto --account a
```

## 常用命令

```bash
# 账号管理（codex-auto 自身命令）
codex-auto add <name>
codex-auto add <name> --auth /path/to/auth.json --config /path/to/config.toml
codex-auto list
codex-auto use <name>
codex-auto remove <name>

# 受管会话（默认）
codex-auto
codex-auto --account <name>
codex-auto --codex-home /path/to/.codex

# 透传给 codex（其余所有参数）
codex-auto [任意 codex 参数...]
codex-auto --account <name> [任意 codex 参数...]
codex-auto --codex-home /path/to/.codex [任意 codex 参数...]
```

## 开发

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

本地重新挂载命令：

```bash
npm link
```

打包检查：

```bash
npm pack --json
```

## 已知限制

- 当前额度检测依赖终端输出中的已知失败提示，不是官方结构化事件
- 如果底层 `codex` 已经丢失当前活跃会话的 session id，`codex-auto` 会停止自动恢复，不会回退到 `resume --last`
- 账号切换基于本地状态顺序，不包含权重、优先级和健康检查

## 许可证

MIT
