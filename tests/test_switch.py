# tests/test_switch.py
"""
端到端账号切换测试。

通过伪造 codex 二进制（python3 脚本），模拟：
  第一次调用 → 输出额度耗尽消息，触发切换
  第二次调用（resume --last）→ 正常退出

验证切换后：
  1. auth.json 已更新为 B 账号的配置
  2. DB is_current 已更新为 B
  3. settings.json currentProviderCodex 已更新为 B
  4. A、B 在 DB 中的 settings_config 互不污染（仍然不同）
"""

import json
import os
import shutil
import sqlite3
import stat
import sys
import textwrap

import pytest
from conftest import load_codex_auto

mod = load_codex_auto()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def make_db(path: str, providers: list) -> None:
    """Create a minimal cc-switch SQLite DB with the given providers."""
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE providers "
        "(id TEXT PRIMARY KEY, name TEXT, app_type TEXT, is_current INTEGER, settings_config TEXT)"
    )
    for p in providers:
        conn.execute(
            "INSERT INTO providers VALUES (?,?,?,?,?)",
            (p["id"], p["name"], "codex", 1 if p["is_current"] else 0,
             json.dumps({"auth": p["auth"], "config": p["config"]})),
        )
    conn.commit()
    conn.close()


def read_db_provider(db_path: str, provider_id: str) -> dict:
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT is_current, settings_config FROM providers WHERE id=?", (provider_id,)
    ).fetchone()
    conn.close()
    is_current, settings_raw = row
    settings = json.loads(settings_raw)
    return {"is_current": bool(is_current), "auth": settings["auth"], "config": settings["config"]}


def make_fake_codex(script_path: str, first_call_script: str, resume_call_script: str) -> str:
    """
    Write a shell wrapper that behaves differently on first vs resume call.
    Uses a sentinel file to track state.
    Returns the path to the wrapper script.
    """
    sentinel = script_path + ".called"
    content = textwrap.dedent(f"""\
        #!/bin/bash
        SENTINEL="{sentinel}"
        if [ "$1" = "resume" ]; then
            # resume call — normal exit
            python3 -c '{resume_call_script}'
        elif [ -f "$SENTINEL" ]; then
            python3 -c '{resume_call_script}'
        else
            touch "$SENTINEL"
            python3 -c '{first_call_script}'
        fi
    """)
    with open(script_path, "w") as f:
        f.write(content)
    os.chmod(script_path, os.stat(script_path).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return script_path


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

def test_switch_updates_auth_and_db_and_settings(tmp_path, monkeypatch):
    """Full switch: quota hit on A → switch to B → verify auth.json, DB, settings.json."""

    # --- Setup fake files ---
    db_path = str(tmp_path / "cc-switch.db")
    auth_path = str(tmp_path / "auth.json")
    config_path = str(tmp_path / "config.toml")
    settings_path = str(tmp_path / "settings.json")

    auth_a = {"token": "TOKEN_A", "account": "account_a"}
    auth_b = {"token": "TOKEN_B", "account": "account_b"}
    config_a = 'model = "gpt-4"\n'
    config_b = 'model = "gpt-5"\n'

    make_db(db_path, [
        {"id": "id-a", "name": "AccountA", "is_current": True,  "auth": auth_a, "config": config_a},
        {"id": "id-b", "name": "AccountB", "is_current": False, "auth": auth_b, "config": config_b},
    ])

    # auth.json initially has A's config (as if cc-switch activated A)
    with open(auth_path, "w") as f:
        json.dump(auth_a, f)
    with open(config_path, "w") as f:
        f.write(config_a)

    # settings.json says A is current
    with open(settings_path, "w") as f:
        json.dump({"currentProviderCodex": "id-a", "otherSetting": "keep"}, f)

    # Patch module constants
    monkeypatch.setattr(mod, "CC_SWITCH_DB", db_path)
    monkeypatch.setattr(mod, "CC_SWITCH_SETTINGS", settings_path)
    monkeypatch.setattr(mod, "CODEX_AUTH_FILE", auth_path)
    monkeypatch.setattr(mod, "CODEX_CONFIG_FILE", config_path)

    # --- Build fake codex binary ---
    quota_msg = "You've hit your usage limit"
    fake_codex = str(tmp_path / "codex")
    make_fake_codex(
        fake_codex,
        first_call_script=f"import sys; print('{quota_msg}'); sys.exit(1)",
        resume_call_script="import sys; sys.exit(0)",
    )

    # --- Patch run_codex_session to use fake binary ---
    original_run = mod.run_codex_session

    call_count = [0]
    def fake_run(args, binary="codex", quota_check_after=0.0, auto_continue=False):
        call_count[0] += 1
        return original_run(args, binary=fake_codex,
                            quota_check_after=quota_check_after,
                            auto_continue=auto_continue)

    monkeypatch.setattr(mod, "run_codex_session", fake_run)

    # Patch sys.exit to capture exit without stopping the test
    exits = []
    def fake_exit(code=0):
        exits.append(code)
        raise SystemExit(code)
    monkeypatch.setattr(sys, "exit", fake_exit)

    # Patch shutil.which so codex-auto doesn't abort at startup
    monkeypatch.setattr(shutil, "which", lambda name: fake_codex if name == "codex" else shutil.which(name))

    # --- Run ---
    monkeypatch.setattr(sys, "argv", ["codex-auto", "hi"])
    with pytest.raises(SystemExit) as exc_info:
        mod.main()

    assert exc_info.value.code == 0, f"Expected clean exit, got {exc_info.value.code}"
    assert call_count[0] == 2, f"Expected 2 codex calls (quota + resume), got {call_count[0]}"

    # --- Verify auth.json has B's config ---
    with open(auth_path) as f:
        live_auth = json.load(f)
    assert live_auth == auth_b, f"auth.json should have B's token, got {live_auth}"

    # --- Verify config.toml has B's config ---
    with open(config_path) as f:
        live_config = f.read()
    assert live_config == config_b, f"config.toml should have B's config, got {live_config!r}"

    # --- Verify DB: B is now current ---
    b_row = read_db_provider(db_path, "id-b")
    assert b_row["is_current"], "DB: B should be is_current=1"

    a_row = read_db_provider(db_path, "id-a")
    assert not a_row["is_current"], "DB: A should be is_current=0"

    # --- Verify DB: configs NOT corrupted ---
    assert a_row["auth"] == auth_a, f"A's DB config should be unchanged, got {a_row['auth']}"
    assert b_row["auth"] == auth_b, f"B's DB config should be unchanged, got {b_row['auth']}"

    # --- Verify settings.json updated ---
    with open(settings_path) as f:
        settings = json.load(f)
    assert settings["currentProviderCodex"] == "id-b", \
        f"settings.json should point to B, got {settings['currentProviderCodex']}"
    # Other settings preserved
    assert settings.get("otherSetting") == "keep", "Other settings.json fields should be preserved"


def test_no_overwrite_on_first_run(tmp_path, monkeypatch):
    """First run must NOT overwrite auth.json even if DB has different config."""

    db_path = str(tmp_path / "cc-switch.db")
    auth_path = str(tmp_path / "auth.json")
    config_path = str(tmp_path / "config.toml")
    settings_path = str(tmp_path / "settings.json")

    auth_live = {"token": "LIVE_TOKEN", "note": "written_by_cc_switch"}
    auth_db   = {"token": "STALE_DB_TOKEN", "note": "stale"}

    make_db(db_path, [
        {"id": "id-a", "name": "AccountA", "is_current": True, "auth": auth_db, "config": ""},
    ])

    # live auth.json has a DIFFERENT (fresher) token than DB
    with open(auth_path, "w") as f:
        json.dump(auth_live, f)
    with open(config_path, "w") as f:
        f.write("")
    with open(settings_path, "w") as f:
        json.dump({"currentProviderCodex": "id-a"}, f)

    monkeypatch.setattr(mod, "CC_SWITCH_DB", db_path)
    monkeypatch.setattr(mod, "CC_SWITCH_SETTINGS", settings_path)
    monkeypatch.setattr(mod, "CODEX_AUTH_FILE", auth_path)
    monkeypatch.setattr(mod, "CODEX_CONFIG_FILE", config_path)

    fake_codex = str(tmp_path / "codex")
    make_fake_codex(
        fake_codex,
        first_call_script="import sys; sys.exit(0)",
        resume_call_script="import sys; sys.exit(0)",
    )

    original_run = mod.run_codex_session
    monkeypatch.setattr(mod, "run_codex_session",
        lambda args, binary="codex", **kw: original_run(args, binary=fake_codex, **kw))
    monkeypatch.setattr(shutil, "which", lambda name: fake_codex if name == "codex" else shutil.which(name))
    monkeypatch.setattr(sys, "argv", ["codex-auto", "hi"])

    with pytest.raises(SystemExit) as exc_info:
        mod.main()

    assert exc_info.value.code == 0

    # auth.json must NOT have been overwritten with stale DB token
    with open(auth_path) as f:
        live_auth = json.load(f)
    assert live_auth == auth_live, \
        f"First run must not overwrite auth.json. Got {live_auth}, expected {auth_live}"
