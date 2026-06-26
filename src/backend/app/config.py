from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "AImotion API"
    debug: bool = True
    upload_dir: str = "uploads"
    results_dir: str = "results"
    max_upload_size_mb: int = 500
    result_ttl_minutes: int = 60
    max_video_duration_sec: int = 30
    default_width: int = 720
    default_height: int = 480
    max_width: int = 768
    max_height: int = 768
    model_name: str = "THUDM/CogVideoX-5b"
    model_type: str = "cogvideox"
    device: str = "cuda"
    dtype: str = "bfloat16"
    offload_text_encoder: bool = True
    hf_token: Optional[str] = None


settings = Settings()
