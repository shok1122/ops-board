import asyncio
import os


class SSHResult:
    def __init__(self, stdout: str, stderr: str, exit_code: int):
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code


async def run_local_command(
    command: str,
    remote_host: str,
    timeout: float = 30.0,
) -> SSHResult:
    """ローカル実行用: コマンドをローカルで実行し、SERVER_HOST 環境変数を渡す。"""
    env = {**os.environ, "SERVER_HOST": remote_host}
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
