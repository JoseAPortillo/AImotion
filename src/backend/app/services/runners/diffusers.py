import logging
from typing import Optional, Callable, Awaitable

from app.services.diffusers_generator import DiffusersGenerator
from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult

logger = logging.getLogger(__name__)


class DiffusersRunner(BaseRunner):
    runner_key = "diffusers"

    def __init__(self, device: Optional[str] = None):
        self._gen = DiffusersGenerator(device)

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> GenerateResult:
        url = await self._gen.generate(
            prompt=params.prompt,
            negative_prompt=params.negative_prompt,
            video_frames=params.video_frames,
            strength=params.strength,
            width=params.width,
            height=params.height,
            steps=params.steps,
            cfg=params.cfg,
            seed=params.seed,
            scheduler=params.scheduler,
            model=params.model,
            num_frames=params.num_frames,
            max_sequence_length=params.max_sequence_length,
            decode_chunk_size=params.decode_chunk_size,
            noise_aug_strength=params.noise_aug_strength,
            min_guidance_scale=params.min_guidance_scale,
            max_guidance_scale=params.max_guidance_scale,
            fps=params.fps,
            motion_bucket_id=params.motion_bucket_id,
            progress_callback=progress_callback,
        )
        media_type = "image/png" if url.endswith(".png") else "video/mp4"
        return GenerateResult(url=url, media_type=media_type)

    def load(self, model_key: str) -> None:
        self._gen._ensure_pipe(model_key)

    def unload(self) -> None:
        self._gen.unload()

    def get_accepted_params(self, model_key: str) -> dict:
        return self._gen.get_accepted_params(model_key)

    @property
    def current_model_key(self):
        return self._gen._current_model_key

    @property
    def current_v2v_model_key(self):
        return self._gen._current_model_key
