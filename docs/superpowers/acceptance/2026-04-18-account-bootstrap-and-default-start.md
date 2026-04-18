# Acceptance Criteria: Account Bootstrap And Default Start

**Spec:** `docs/superpowers/specs/2026-04-18-account-bootstrap-and-default-start-design.md`
**Date:** 2026-04-18
**Status:** Approved

---

## Criteria

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-001 | 当 `state.json` 中没有任何账号且源 `CODEX_HOME/auth.json` 存在且非空时，首次运行受管会话会自动引导一个名为 `default` 的账号。 | API | `~/.codex-auto/state.json` 不存在或账号列表为空；源 `CODEX_HOME/auth.json` 存在且包含有效 JSON；执行 `codex-auto` 或等效受管入口。 | `~/.codex-auto/accounts/default/auth.json` 被创建，`state.json.accounts` 变为 `["default"]`，且本次运行继续执行而不是报 “No accounts configured”。 |
| AC-002 | 首次自动引导时，如果源 `CODEX_HOME/config.toml` 存在，会一并导入到 `accounts/default/config.toml`。 | Logic | AC-001 的前置条件成立，且源 `CODEX_HOME/config.toml` 存在。 | `accounts/default/config.toml` 文件存在，内容与源 `config.toml` 一致。 |
| AC-003 | 首次自动引导完成后，`default` 会被持久设置为默认起始账号。 | Logic | AC-001 的前置条件成立并执行成功。 | `state.json.preferredAccountName` 等于 `"default"`，且 `state.json.currentIndex` 为 `0`。 |
| AC-004 | 当已有持久默认起始账号时，裸跑 `codex-auto` 会优先从该账号开始，而不是从 `currentIndex` 对应账号开始。 | API | `state.json.accounts` 至少包含两个账号；`preferredAccountName` 指向其中一个账号；`currentIndex` 指向另一个账号；执行未带 `--account` 的受管会话。 | 本次启动使用 `preferredAccountName` 对应账号的 `auth.json`，且不会因为 `currentIndex` 指向其他账号而改成别的起始账号。 |
| AC-005 | `--account <name>` 的一次性覆盖优先级高于持久默认起始账号。 | API | `state.json.accounts` 至少包含两个账号；`preferredAccountName` 已设置；执行 `codex-auto --account <other-name>`。 | 本次启动使用 `--account` 指定账号；`state.json.preferredAccountName` 保持原值不变。 |
| AC-006 | `codex-auto use <name>` 会把指定账号保存为新的默认起始账号。 | API | `state.json.accounts` 包含 `<name>`；执行 `codex-auto use <name>`。 | 命令退出码为 `0`；输出确认默认起始账号已更新；`state.json.preferredAccountName` 等于 `<name>`。 |
| AC-007 | `codex-auto use <name>` 指向不存在账号时会失败且不改状态。 | API | `state.json.accounts` 不包含 `<name>`；执行 `codex-auto use <name>`。 | 命令退出码为非零；stderr 输出账号不存在错误；`state.json.preferredAccountName` 保持调用前的值。 |
| AC-008 | `codex-auto list` 会同时标出当前轮转指针和默认起始账号。 | API | `state.json.accounts` 至少包含两个账号，且 `currentIndex` 与 `preferredAccountName` 可以相同或不同；执行 `codex-auto list`。 | 输出中当前轮转指针所在账号前有 `*`，默认起始账号行带有 `(default)`，两者信息可同时辨认。 |
| AC-009 | 删除默认起始账号后，如果还存在其他账号，系统会自动把默认起始账号回退到账号列表第一个账号。 | Logic | `state.json.accounts` 至少包含两个账号，`preferredAccountName` 指向其中一个；执行删除该账号的逻辑。 | 删除完成后 `state.json.preferredAccountName` 等于删除后 `accounts[0]`。 |
| AC-010 | 删除最后一个账号后，默认起始账号和当前轮转指针都会被清空。 | Logic | `state.json.accounts` 仅包含一个账号，且该账号也是 `preferredAccountName`；执行删除。 | 删除完成后 `state.json.accounts` 为空，`currentIndex` 为 `null`，`preferredAccountName` 为 `null`。 |
| AC-011 | 运行期自动切号和恢复成功后，会更新轮转状态，但不会改写用户设定的默认起始账号。 | Logic | 至少有两个账号；`preferredAccountName` 已设定；会话中触发额度切号并成功恢复。 | 运行后 `currentIndex` 和 `lastSuccessfulAccount` 可更新为实际使用账号，但 `preferredAccountName` 保持切号前的值。 |
| AC-012 | README 会把“首次自动引导 default”和“设置默认起始账号”作为用户能力写入产品说明。 | Logic | 仓库文档已更新。 | `README.md` 与 `README.zh-CN.md` 都包含首次自动引导和设置默认起始账号的使用说明，且文案以产品能力和使用方式为主，不以内部实现细节为主。 |
