from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_path: str = "/data/opsboard.db"
    secret_key: str = "change-me-in-production-32bytes!!"

    class Config:
        env_file = ".env"


settings = Settings()
