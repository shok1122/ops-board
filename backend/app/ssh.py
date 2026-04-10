import asyncio
import time
import asyncssh
from typing import Optional


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
    lines: int = 500,
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    passphrase: Optional[str] = None,
    timeout: float = 30.0,
) -> SSHResult:
    command = f"tail -n {lines} {file_path}"
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
