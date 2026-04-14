import asyncio
import os
import re
import time
from pathlib import Path
from typing import Optional

import asyncssh

_MONITOR_SCRIPTS_DIR = Path(__file__).parent / "scripts" / "monitors"


def _load_monitor_cmd(name: str) -> str:
    """scripts/monitors/{name}.sh の内容を読み込んで返す（末尾の空白を除去）。"""
    return (_MONITOR_SCRIPTS_DIR / f"{name}.sh").read_text(encoding="utf-8").strip()


def _expand_template(template: str, config: dict) -> str:
    """{key} プレースホルダーを config の値で置換する。

    Python の str.format() と異なり、awk の '{print $1}' のような
    シェル構文内の波括弧には触れない（\w+ のみにマッチ）。
    """
    def _replace(m: re.Match) -> str:
        key = m.group(1)
        return str(config[key]) if key in config else m.group(0)
    return re.sub(r'\{(\w+)\}', _replace, template)


class SSHResult:
    def __init__(self, stdout: str, stderr: str, exit_code: int):
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code


async def _connect(
    host: str,
    port: int,
    username: str,
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    passphrase: Optional[str] = None,
    timeout: float = 10.0,
) -> asyncssh.SSHClientConnection:
    connect_kwargs: dict = {
        "host": host,
        "port": port,
        "username": username,
        "connect_timeout": timeout,
        "known_hosts": None,  # Skip host key verification (document this caveat)
    }
    if private_key:
        key = asyncssh.import_private_key(private_key, passphrase=passphrase)
        connect_kwargs["client_keys"] = [key]
        connect_kwargs["password"] = None
    elif password:
        connect_kwargs["password"] = password

    return await asyncssh.connect(**connect_kwargs)


async def run_command(
    host: str,
    port: int,
    username: str,
    command: str,
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    passphrase: Optional[str] = None,
    timeout: float = 30.0,
) -> SSHResult:
    # Use asyncssh's native timeout parameter for conn.run() instead of
    # asyncio.wait_for(), because Python 3.12 changed wait_for behavior:
    # it now waits for the cancelled task to fully exit, and asyncssh's
    # conn.run() may not promptly handle CancelledError, causing indefinite blocking.
    conn = await asyncio.wait_for(
        _connect(host, port, username, password, private_key, passphrase),
        timeout=timeout,
    )
    try:
        result = await conn.run(command, check=False, timeout=timeout)
        return SSHResult(
            stdout=result.stdout or "",
            stderr=result.stderr or "",
            exit_code=result.exit_status if result.exit_status is not None else -1,
        )
    finally:
        conn.close()


async def fetch_file(
    host: str,
    port: int,
    username: str,
    file_path: str,
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    passphrase: Optional[str] = None,
    timeout: float = 30.0,
) -> SSHResult:
    """Fetch a file's full contents (expected to be a single JSON document)."""
    command = f"cat {file_path}"
    return await run_command(
        host, port, username, command,
        password=password, private_key=private_key, passphrase=passphrase,
        timeout=timeout,
    )


async def get_system_status(
    host: str,
    port: int,
    username: str,
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    passphrase: Optional[str] = None,
    timeout: float = 15.0,
) -> dict:
    command = (
        "awk '{print \"load=\"$1}' /proc/loadavg; "
        "free -m | awk '/^Mem:/{print \"mem_used=\"$3\"\\nmem_total=\"$2}'; "
        "df -BG / | awk 'NR==2{gsub(/G/,\"\"); print \"disk_used=\"$3\"\\ndisk_total=\"$2}'; "
        "awk '{printf \"uptime=%d\\n\",$1}' /proc/uptime; "
        "grep -m1 PRETTY_NAME /etc/os-release 2>/dev/null | sed 's/PRETTY_NAME=/os=/' | tr -d '\"' || echo 'os=Unknown'"
    )
    result = await run_command(
        host, port, username, command,
        password=password, private_key=private_key, passphrase=passphrase,
        timeout=timeout,
    )
    parsed: dict = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            parsed[k.strip()] = v.strip()

    def _float(key: str):
        try:
            return float(parsed[key])
        except (KeyError, ValueError):
            return None

    def _int(key: str):
        try:
            return int(parsed[key])
        except (KeyError, ValueError):
            return None

    return {
        "cpu_load_1m": _float("load"),
        "mem_used_mb": _int("mem_used"),
        "mem_total_mb": _int("mem_total"),
        "disk_used_gb": _float("disk_used"),
        "disk_total_gb": _float("disk_total"),
        "uptime_seconds": _int("uptime"),
        "os_info": parsed.get("os"),
        "error": result.stderr.strip() if result.exit_code != 0 else None,
    }


# mem_used の unit_type 別コマンド（collect_metric で動的選択）
# scripts/monitors/mem_used_pct.sh / mem_used_mb.sh から読み込む
_MEM_USED_COMMANDS: dict[str, str] = {
    "pct": _load_monitor_cmd("mem_used_pct"),
    "mb":  _load_monitor_cmd("mem_used_mb"),
}

BUILTIN_METRIC_COMMANDS: dict[str, str] = {
    # ── 統合メトリクス（変数選択対応）────────────────────────────────────
    # cpu_load: {awk_field} は collect_metric 内で interval → $1/$2/$3 に変換
    "cpu_load":      _load_monitor_cmd("cpu_load"),
    # mem_used: collect_metric 内で unit_type に応じてコマンドを切り替え
    "mem_used":      _MEM_USED_COMMANDS["pct"],
    # ── 個別キー（後方互換のため保持、UI には表示しない）──────────────
    "cpu_load_1m":   _load_monitor_cmd("cpu_load_1m"),
    "cpu_load_5m":   _load_monitor_cmd("cpu_load_5m"),
    "cpu_load_15m":  _load_monitor_cmd("cpu_load_15m"),
    "mem_used_pct":  _MEM_USED_COMMANDS["pct"],
    "mem_used_mb":   _MEM_USED_COMMANDS["mb"],
    # ── その他 ───────────────────────────────────────────────────────────
    "disk_used_pct": _load_monitor_cmd("disk_used_pct"),
    "disk_used_gb":  _load_monitor_cmd("disk_used_gb"),
    "process_count": _load_monitor_cmd("process_count"),
    "ssl_cert_expiry_days": _load_monitor_cmd("ssl_cert_expiry_days"),
}


async def collect_metric(
    host: str,
    port: int,
    username: str,
    metric_type: str,
    builtin_key: Optional[str] = None,
    builtin_config: Optional[dict] = None,
    custom_script: Optional[str] = None,
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    passphrase: Optional[str] = None,
    timeout: float = 15.0,
) -> tuple[Optional[float], Optional[str]]:
    """Collect a single metric value via SSH. Returns (value, error)."""
    if metric_type == "builtin":
        if not builtin_key or builtin_key not in BUILTIN_METRIC_COMMANDS:
            return None, f"Unknown builtin metric key: {builtin_key}"
        config = {**(builtin_config or {})}
        # command_override が指定されていればそれを使う
        if "command_override" in config:
            command = config["command_override"]
        else:
            template = BUILTIN_METRIC_COMMANDS[builtin_key]
            config.setdefault("path", "/")
            config.setdefault("host", host)
            config.setdefault("port", "443")
            # cpu_load: interval (1m/5m/15m) → awk フィールド番号に変換
            if builtin_key == "cpu_load":
                _field_map = {"1m": "$1", "5m": "$2", "15m": "$3"}
                config["awk_field"] = _field_map.get(config.get("interval", "1m"), "$1")
            # mem_used: unit_type (pct/mb) に応じてコマンドを切り替え
            elif builtin_key == "mem_used":
                template = _MEM_USED_COMMANDS.get(config.get("unit_type", "pct"), _MEM_USED_COMMANDS["pct"])
            command = _expand_template(template, config)
    else:
        if not custom_script:
            return None, "No custom script provided"
        command = custom_script

    result = await run_command(
        host, port, username, command,
        password=password, private_key=private_key, passphrase=passphrase,
        timeout=timeout,
    )
    if result.exit_code != 0:
        error = result.stderr.strip() or f"Exit code {result.exit_code}"
        return None, error
    try:
        value = float(result.stdout.strip())
        return value, None
    except (ValueError, TypeError):
        return None, f"Could not parse output as number: {result.stdout.strip()[:100]}"


async def run_local_command(
    command: str,
    remote_host: str,
    timeout: float = 30.0,
) -> SSHResult:
    """SSH不要サーバー用: コマンドをローカルで実行し、REMOTE_HOST 環境変数を渡す。"""
    env = {**os.environ, "REMOTE_HOST": remote_host}
    proc = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return SSHResult(
            stdout=stdout.decode(errors="replace"),
            stderr=stderr.decode(errors="replace"),
            exit_code=proc.returncode if proc.returncode is not None else -1,
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        raise


async def test_connection(
    host: str,
    port: int,
    username: str,
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    passphrase: Optional[str] = None,
) -> tuple[bool, Optional[float], Optional[str]]:
    start = time.monotonic()
    try:
        async with await asyncio.wait_for(
            _connect(host, port, username, password, private_key, passphrase),
            timeout=10.0,
        ) as conn:
            await conn.run("echo ok", check=False)
        elapsed = (time.monotonic() - start) * 1000
        return True, round(elapsed, 1), None
    except Exception as e:
        return False, None, str(e)
