from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "AImotion API"
    debug: bool = True
    upload_dir: str = "uploads"
    results_dir: str = "results"
    max_upload_size_mb: int = 500
    result_ttl_minutes: int = 60
    max_video_duration_sec: int = 30
    default_width: int = 512
    default_height: int = 512
    max_width: int = 768
    max_height: int = 768
    model_name: str = "Lightricks/LTX-Video-2B-v0.9"
    device: str = "cuda"
    dtype: str = "bfloat16"
    offload_text_encoder: bool = True


settings = Settings()
