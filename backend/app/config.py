from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_path: str = "/data/opsboard.db"
    secret_key: str = "change-me-in-production-32bytes!!"
    scripts_dir: str = "/data/scripts"

    server_status_retention_days: int = 7
    worker_log_retention: int = 100

    # Authentication settings
    # AUTH_PASSWORD が空の場合は認証無効
    auth_password: str = ""
    auth_max_attempts: int = 5        # 連続失敗でロックされるまでの回数
    auth_lockout_minutes: int = 15    # ロックアウト継続時間（分）
    auth_token_expire_hours: int = 24  # トークン有効期限（時間）

    # Teams 通知設定（docker-compose で指定する）
    # TEAMS_WEBHOOK_URL が空の場合は通知機能そのものが使えない
    teams_webhook_url: str = ""
    teams_timeout_sec: float = 10.0    # Webhook 送信のタイムアウト（秒）
    teams_dashboard_url: str = ""      # 通知文に載せるダッシュボードの URL（任意）

    class Config:
        env_file = ".env"


settings = Settings()
