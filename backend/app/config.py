from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_path: str = "/data/opsboard.db"
    secret_key: str = "change-me-in-production-32bytes!!"

    # Authentication settings
    # AUTH_PASSWORD が空の場合は認証無効
    auth_password: str = ""
    auth_max_attempts: int = 5        # 連続失敗でロックされるまでの回数
    auth_lockout_minutes: int = 15    # ロックアウト継続時間（分）
    auth_token_expire_hours: int = 24  # トークン有効期限（時間）

    class Config:
        env_file = ".env"


settings = Settings()
