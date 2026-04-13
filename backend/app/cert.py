import asyncio
import ssl
from datetime import datetime, timezone
from typing import Optional

from cryptography import x509
from cryptography.hazmat.backends import default_backend


async def check_ssl_certificate(
    host: str,
    port: int = 443,
    timeout: float = 10.0,
) -> tuple[Optional[float], Optional[str]]:
    """TLS接続してサーバ証明書を取得し、有効期限までの日数を返す。

    Returns:
        (days_until_expiry, error): 失敗時は (None, error_message)
    """
    loop = asyncio.get_event_loop()

    def _fetch_cert_pem() -> str:
        return ssl.get_server_certificate((host, port), timeout=timeout)

    try:
        pem = await asyncio.wait_for(
            loop.run_in_executor(None, _fetch_cert_pem),
            timeout=timeout + 2,
        )
        cert = x509.load_pem_x509_certificate(pem.encode(), default_backend())
        expiry = cert.not_valid_after_utc
        now = datetime.now(timezone.utc)
        days_left = (expiry - now).total_seconds() / 86400
        return round(days_left, 1), None
    except asyncio.TimeoutError:
        return None, f"接続タイムアウト ({int(timeout)}秒)"
    except Exception as e:
        return None, str(e)


async def get_certificate_info(
    host: str,
    port: int = 443,
    timeout: float = 10.0,
) -> dict:
    """証明書の詳細情報を返す。"""
    loop = asyncio.get_event_loop()

    def _fetch_cert_pem() -> str:
        return ssl.get_server_certificate((host, port), timeout=timeout)

    try:
        pem = await asyncio.wait_for(
            loop.run_in_executor(None, _fetch_cert_pem),
            timeout=timeout + 2,
        )
        cert = x509.load_pem_x509_certificate(pem.encode(), default_backend())
        expiry = cert.not_valid_after_utc
        not_before = cert.not_valid_before_utc
        now = datetime.now(timezone.utc)
        days_left = (expiry - now).total_seconds() / 86400

        subject = cert.subject.rfc4514_string()
        issuer = cert.issuer.rfc4514_string()

        return {
            "ok": True,
            "days_until_expiry": round(days_left, 1),
            "not_before": not_before.isoformat(),
            "not_after": expiry.isoformat(),
            "subject": subject,
            "issuer": issuer,
            "error": None,
        }
    except asyncio.TimeoutError:
        return {"ok": False, "error": f"接続タイムアウト ({int(timeout)}秒)"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
