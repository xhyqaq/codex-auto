# Acceptance Criteria: Account Retry Time Display

**Spec:** `docs/superpowers/specs/2026-04-18-account-retry-time-design.md`
**Date:** 2026-04-18
**Status:** Approved

---

## Criteria

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-001 | 额度耗尽输出中包含 `or try again at <time>.` 时，系统会提取原始时间字符串。 | Logic | 输入为已 sanitize 的额度耗尽文本，包含 `or try again at 11:10 PM.`。 | 提取结果包含 `displayText: "11:10 PM"`。 |
| AC-002 | 提取到的时间字符串会被转换成内部可比较的恢复时间戳。 | Logic | 当前本地时间已知，输入时间字符串为 `11:10 PM`。 | 解析结果包含一个有效的 ISO 时间戳；若当天该时间已过去，则结果落在次日。 |
| AC-003 | 某账号命中额度限制且恢复时间可提取时，`state.json` 会为该账号保存恢复时间信息。 | Logic | 至少存在两个账号；第一个账号运行时输出额度耗尽文案和恢复时间。 | 运行结束后 `state.json.retryAvailabilityByAccount[firstAccount]` 存在，且同时包含 `displayText` 与 `availableAt`。 |
| AC-004 | 某账号后续成功运行后，该账号的恢复时间状态会被清除。 | Logic | `state.json.retryAvailabilityByAccount` 中已存在某账号的恢复时间记录；随后该账号成功完成一次运行。 | 运行结束后该账号不再出现在 `retryAvailabilityByAccount` 中。 |
| AC-005 | 加载状态时会自动清理已过期的恢复时间记录。 | Logic | `state.json.retryAvailabilityByAccount` 中存在一个 `availableAt <= now` 的记录。 | `loadState()` 返回结果中不包含该账号的恢复时间记录。 |
| AC-006 | `codex-auto list` 会在账号后面展示恢复时间字符串。 | API | 某账号在状态中有恢复时间记录，且未过期。 | `codex-auto list` 输出该账号行包含 `retry at <displayText>`。 |
| AC-007 | 当账号同时是默认起始账号且仍在等待恢复时，`list` 输出会同时保留两个标签。 | API | 某账号同时满足 `preferredAccountName === account` 且有未过期恢复时间。 | 该账号行输出同时包含 `(default` 和 `retry at <displayText>`，两者可同时辨认。 |
| AC-008 | 删除账号时会一并移除该账号的恢复时间记录。 | Logic | `retryAvailabilityByAccount` 中包含被删除账号的记录。 | 删除后状态中不再包含该账号的恢复时间记录。 |
| AC-009 | 当额度耗尽文案里没有恢复时间时，原有自动切号流程仍正常运行。 | Logic | 额度耗尽文本只包含 `You've hit your usage limit`，不包含 `or try again at ...`。 | 会话仍会按原逻辑切到下一个账号；状态中不会新增该账号的恢复时间记录。 |
| AC-010 | README 会把列表展示恢复时间作为用户能力写入产品说明。 | Logic | 仓库文档已更新。 | `README.md` 与 `README.zh-CN.md` 都说明 `list` 会显示等待恢复的账号及其恢复时间，且文案以用户能力为主。 |
