import base64
import hashlib
import hmac
import json
import secrets
import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

# ---- In-memory lockout state ----
_lock = Lock()
_attempts: dict[str, int] = defaultdict(int)  # ip -> 連続失敗回数
_locked_until: dict[str, float] = {}           # ip -> ロック解除 UNIX timestamp


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_lockout(ip: str) -> None:
    with _lock:
        until = _locked_until.get(ip, 0.0)
        if until > time.time():
            remaining = int(until - time.time())
            raise HTTPException(
                status_code=429,
                detail=f"Too many failed attempts. Try again in {remaining} seconds.",
            )


def _record_failure(ip: str) -> None:
    with _lock:
        _attempts[ip] += 1
        if _attempts[ip] >= settings.auth_max_attempts:
            _locked_until[ip] = time.time() + settings.auth_lockout_minutes * 60
            _attempts[ip] = 0


def _record_success(ip: str) -> None:
    with _lock:
        _attempts.pop(ip, None)
        _locked_until.pop(ip, None)


# ---- Token helpers ----

def _sign(data: str) -> str:
    return hmac.new(
        settings.secret_key.encode(),
        data.encode(),
        hashlib.sha256,
    ).hexdigest()


def create_token() -> str:
    expire = int(time.time()) + settings.auth_token_expire_hours * 3600
    payload = json.dumps({"exp": expire, "jti": secrets.token_hex(16)})
    data = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    sig = _sign(data)
    return f"{data}.{sig}"


def verify_token(token: str) -> bool:
    try:
        data, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(sig, _sign(data)):
            return False
        padding = (4 - len(data) % 4) % 4
        payload = json.loads(base64.urlsafe_b64decode(data + "=" * padding))
        return int(payload["exp"]) >= int(time.time())
    except Exception:
        return False


# ---- Routes ----

class LoginRequest(BaseModel):
    password: str


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    if not settings.auth_password:
        # 認証無効の場合は即座にトークンを返す
        return {"token": create_token(), "auth_required": False}

    ip = _client_ip(request)
    _check_lockout(ip)

    if not hmac.compare_digest(body.password, settings.auth_password):
        _record_failure(ip)
        raise HTTPException(status_code=401, detail="Invalid password.")

    _record_success(ip)
    return {"token": create_token(), "auth_required": True}


@router.get("/status")
async def auth_status():
    """認証が必要かどうかを返す（公開エンドポイント）"""
    return {"auth_required": bool(settings.auth_password)}


# ---- Dependency ----

async def require_auth(authorization: str = Header(default="")) -> None:
    """全保護ルートに付与する認証 Dependency"""
    if not settings.auth_password:
        return  # 認証無効

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")

    token = authorization[len("Bearer "):]
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
