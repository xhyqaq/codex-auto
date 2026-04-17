# codex-auto

`codex-auto` 是一个给 `codex` CLI 用的多账号切换器。

它维护多套独立的 `CODEX_HOME`，当当前账号命中额度限制时，自动切到下一个账号，并尽量恢复到刚才的会话继续执行。

## 适用场景

- 你有多个可用的 Codex 账号
- 不想手动改 `auth.json`、`config.toml`
- 希望额度耗尽后自动切号并恢复会话

## 当前能力

- 管理多套账号配置
- 首次添加账号时直接跑 `codex login`
- 支持导入现成的 `auth.json` 和 `config.toml`
- 启动受管 `codex` 会话
- 命中额度限制后自动切到下一个账号
- 优先用记录的 session id 恢复会话
- session id 失效时回退到 `codex resume --last`
- 恢复时自动补发 `Continue`
- 记录运行日志和状态文件

## 前置要求

- Node.js 18+
- 本机已安装可执行的 `codex` CLI
- `codex` 可以正常执行 `codex login`、`codex resume`

## 安装

推荐安装方式：

```bash
npm install -g git+https://github.com/xhyqaq/codex-auto.git
```

安装后验证：

```bash
codex-auto --help
```

升级到最新版本：

```bash
npm install -g git+https://github.com/xhyqaq/codex-auto.git
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

添加账号：

```bash
codex-auto add a
codex-auto add b
```

查看账号列表：

```bash
codex-auto list
```

启动受管会话：

```bash
codex-auto
```

从指定账号启动：

```bash
codex-auto --account b
```

删除账号：

```bash
codex-auto remove b
```

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
~/.codex-auto/
├── accounts/
│   ├── a/
│   │   ├── auth.json
│   │   ├── config.toml
│   │   └── meta.json
│   └── b/
├── runtime/
│   ├── auth.json
│   ├── config.toml
│   ├── session_index.jsonl
│   └── sessions/
├── logs/
└── state.json
```

其中：

- `accounts/<name>/` 保存每个账号自己的配置
- `runtime/` 是当前实际交给 `codex` 使用的运行时目录
- `state.json` 保存账号顺序、当前索引、上次成功账号、最近 session id
- `logs/` 保存会话日志和终端 transcript

每次启动前，`codex-auto` 会把目标账号的 `auth.json` 和 `config.toml` 同步到 `runtime/`，然后用这个 runtime 启动 `codex`。

## 切号与恢复逻辑

当前版本只在检测到真实的额度耗尽提示时触发切号，避免把提醒类文案误判成失败。

命中额度限制后：

1. 标记当前账号已耗尽
2. 切换到下一个可用账号
3. 从 runtime 中读取最新 session id
4. 优先执行：

```bash
codex resume <session-id> Continue
```

5. 如果该 session id 已失效，再回退到：

```bash
codex resume --last
```

为了避免历史 transcript 干扰，恢复场景下只有最新 prompt 之后的新输出才会参与额度检测。

## 环境变量

- `CODEX_AUTO_HOME`
  指定 `codex-auto` 的数据目录，默认是 `~/.codex-auto`

- `CODEX_AUTO_CODEX_BIN`
  指定底层 `codex` 可执行文件路径，默认是 `codex`

示例：

```bash
CODEX_AUTO_HOME=/tmp/codex-auto \
CODEX_AUTO_CODEX_BIN=/opt/homebrew/bin/codex \
codex-auto --account a
```

## 常用命令

```bash
codex-auto add <name>
codex-auto add <name> --auth /path/to/auth.json --config /path/to/config.toml
codex-auto list
codex-auto remove <name>
codex-auto --account <name>
codex-auto
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
- `resume --last` fallback 不会额外拼 prompt，只负责先把会话恢复起来
- 账号切换基于本地状态顺序，不包含权重、优先级和健康检查

## 许可证

MIT
