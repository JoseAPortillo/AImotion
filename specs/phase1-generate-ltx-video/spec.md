# Phase 1 Spec: Real Video Generation with LTX-Video

## Goal

A user can open a web page on `localhost`, upload a video + write a prompt, and get a real generated video back from LTX-Video 2B running locally on an RTX 3080.

## Scope

- FastAPI backend with two endpoints: `/health` and async `/generate`
- LTX-Video 2B integration via diffusers (FP8, CPU-offloaded text encoder)
- Minimal web UI (HTML/JS, no framework, no build step)
- Async task queue with progress polling
- pytest test suite for all backend modules

## Out of Scope (explicit)

- Node graph editor (Phase 2)
- Tauri desktop shell (Phase 2)
- Multiple model support (Phase 2)
- Cloud provider adapters (Phase 2)
- Image input or reference conditioning (Phase 2)
- Audio input or conditioning (Phase 3)
- FFmpeg muxing or export controls (Phase 3)
- Credential manager (Phase 3)
- Model installer (Phase 3)
- Group nodes (Phase 2)
- SpecSecOps adversarial reviews (Phase 3)
- ZIP ingestion or image sequences (Phase 2)

## 1. Backend API

### 1.1 GET /health

**Purpose:** Liveness probe for the backend.

**Response 200:**
```json
{
  "status": "ok",
  "service": "aimotion",
  "gpu_available": true,
  "gpu_name": "NVIDIA GeForce RTX 3080",
  "vram_total_gb": 10,
  "vram_free_gb": 7.2
}
```

`gpu_available` is `false` if no CUDA GPU is detected. The service still returns 200 — this is informational, not a readiness gate for Phase 1.

### 1.2 POST /generate

**Purpose:** Submit a generation job. Accepts multipart form data.

**Request:**

| Field | Type | Required | Description |
|---|---|---|---|
| `video` | file | yes | Input video file. Max 500 MB. Accepted formats: mp4, mov, avi, mkv. |
| `prompt` | string | yes | Positive prompt for generation. Max 1000 chars. |
| `negative_prompt` | string | no | Negative prompt. Max 1000 chars. Default: empty string. |
| `width` | int | no | Output width in pixels. Must be multiple of 8. Default: 512. Max: 768. |
| `height` | int | no | Output height in pixels. Must be multiple of 8. Default: 512. Max: 768. |
| `steps` | int | no | Denoising steps. Default: 25. Range: 1-100. |
| `cfg` | float | no | CFG scale. Default: 7.5. Range: 1.0-20.0. |
| `seed` | int | no | Random seed. Default: random (0 = random). |

If video dimensions exceed width/height, the video is center-cropped and resized to fit. No aspect ratio bucketing in Phase 1 (deferred to Phase 2).

**Response 202:**
```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending"
}
```

### 1.3 GET /generate/{task_id}

**Purpose:** Poll generation status and result.

**Response while running:**
```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running",
  "progress": 0.45,
  "current_step": 11,
  "total_steps": 25,
  "eta_sec": 45
}
```

`progress` is a float 0.0-1.0.

**Response on completion:**
```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "progress": 1.0,
  "result_url": "/results/a1b2c3d4-e5f6-7890-abcd-ef1234567890.mp4"
}
```

**Response on failure:**
```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "failed",
  "error": "CUDA out of memory. Try reducing resolution or enabling CPU offload."
}
```

### 1.4 GET /results/{filename}

**Purpose:** Serve the generated video file.

**Response 200:** `video/mp4` stream.

**Response 404:** File not found or expired.

Generated files are cleaned up after 1 hour via a background cleanup task (or on server restart).

## 2. LTX-Video 2B Integration

### Model Loading

- Load `Lightricks/LTX-Video-2B-v0.9` from Hugging Face via diffusers.
- Enable FP8 quantisation via `bitsandbytes` (`load_in_8bit=True` or `torch_dtype=torch.bfloat16` with FP8 compute).
- CPU-offload the T5-XXL text encoder using `accelerate` (`device_map="auto"` with CPU offload for encoder).
- Use `enable_model_cpu_offload()` for the transformer and VAE to free VRAM between forward passes.
- FlashAttention: detect compute capability. If >= 8.9, enable FlashAttention. Otherwise fall back to xFormers or SDPA (PyTorch 2.3+ default).

### Generation Pipeline

1. Load input video with `decord` or `torchvision.io`, extract frames at original FPS.
2. Resize/crop frames to target resolution (center crop + resize).
3. VAE encode frames to latent space.
4. Encode prompt via T5-XXL (CPU-offloaded).
5. Run Flow Matching denoising loop for `steps` iterations.
6. VAE decode denoised latent back to pixel space.
7. Write output video with `torchvision.io.write_video` or imageio-ffmpeg.
8. Store result in `results/` directory with task ID as filename.

### VRAM Management

- Max resolution: 512x512 default, 768x768 max (may OOM at max).
- If OOM detected during generation, catch the exception and return a user-friendly error suggesting lower resolution.
- Log VRAM usage before and after model load for diagnostics.

### Error Handling

| Error | User-facing message |
|---|---|
| CUDA OOM | "CUDA out of memory. Try reducing resolution or enabling CPU offload." |
| Model load failure | "Failed to load LTX-Video 2B. Check Hugging Face token or disk space." |
| Invalid video file | "Could not read video file. Supported formats: mp4, mov, avi, mkv." |
| Video too long | "Video exceeds maximum duration of 30 seconds." |
| Unknown error | "Generation failed: {error message}" |

## 3. Web UI

### Layout

Single HTML page served at `http://localhost:8001/` with:

1. **File upload** area (drag & drop + click to browse). Accepted: .mp4, .mov, .avi, .mkv. Shows filename + size after selection.
2. **Prompt textarea** for positive prompt. Placeholder: "Describe the scene you want to generate..."
3. **Negative prompt textarea** (collapsible). Placeholder: "Elements to avoid..."
4. **Generate button** — disabled while generation is running.
5. **Progress bar** + status text + ETA during generation.
6. **Video preview player** after generation completes. Shows the generated result.
7. **Download button** for the generated MP4.

### Behavior

- Page loads → checks `/health` to confirm backend is up. Shows "Backend connected" or "Backend unavailable" banner.
- User uploads video (stored on backend in `uploads/`).
- User enters prompt, clicks Generate.
- Frontend calls `POST /generate` with multipart form data, gets `task_id`.
- Frontend polls `GET /generate/{task_id}` every 2 seconds.
- Progress bar updates on each poll.
- On completion, show video preview with download link.
- On failure, show error message.
- **No refresh needed** — all state managed in-page.

### Technical Constraints

- No npm, no build step, no framework. Single HTML file + optional CSS/JS files served by FastAPI as static files.
- Vanilla JS. ES6+ syntax (modern browsers only).
- Responsive design that works at 1024x768 minimum.

## 4. Testing (pytest)

### Coverage Requirements

- Minimum 80% coverage on `app/core/`, `app/api/`, `app/models/`.
- Upload tasks to `src/backend/tests/`.

### Test Suite: `test_health.py`

- `test_health_returns_200`: GET /health returns 200.
- `test_health_response_shape`: Response contains expected fields (status, service, gpu_available).
- `test_health_gpu_fallback`: When no CUDA, gpu_available is false but response is still 200.

### Test Suite: `test_generate.py`

- `test_generate_accepts_valid_request`: POST /generate with valid file + prompt returns 202.
- `test_generate_rejects_missing_video`: POST /generate without video returns 422.
- `test_generate_rejects_missing_prompt`: POST /generate with file but no prompt returns 422.
- `test_generate_rejects_empty_prompt`: POST /generate with empty prompt returns 422.
- `test_generate_rejects_oversized_file`: POST /generate with file >500 MB returns 413.
- `test_generate_rejects_invalid_format`: POST /generate with .txt file returns 422.
- `test_generate_validates_width`: POST /generate with width=10 (not multiple of 8) returns 422.
- `test_generate_validates_height`: POST /generate with height=10 (not multiple of 8) returns 422.
- `test_generate_validates_steps_range`: POST /generate with steps=0 returns 422.
- `test_generate_validates_steps_range_high`: POST /generate with steps=101 returns 422.

### Test Suite: `test_generate_task.py`

- `test_task_status_pending`: New task returns status "pending".
- `test_task_status_transitions`: Task goes pending → running → completed.
- `test_task_status_failed`: Task with invalid params returns "failed" with error message.
- `test_task_unknown_id`: GET /generate/{nonexistent_id} returns 404.
- `test_task_progress_increases`: Progress monotonically increases during generation.
- `test_task_cleanup`: Completed tasks are cleaned up after timeout.

### Test Suite: `test_results.py`

- `test_results_serves_file`: GET /results/{existing_filename} returns 200 with video/mp4.
- `test_results_404`: GET /results/{nonexistent_filename} returns 404.

### Test Suite: `test_model.py`

- `test_model_loads`: LTX-Video pipeline can be instantiated (uses a small stub or mock in CI; integration test marker for real runs).
- `test_model_generates_output`: With a dummy input, the pipeline produces expected tensor shape.
- `test_model_vram_logging`: VRAM is logged before and after load.

### Test Configuration

- `pytest.ini` or `pyproject.toml` with `[tool.pytest.ini_options]`:
  - `testpaths = ["tests"]`
  - `asyncio_mode = "auto"`
  - `markers = ["integration: marks tests that require GPU and actual model weights"]`
- Required packages: `pytest`, `pytest-asyncio`, `httpx`, `pytest-cov`.
- Integration tests skipped by default. Run with `pytest -m integration`.

## 5. File Structure

```
src/
└── backend/
    ├── requirements.txt
    ├── pytest.ini
    ├── app/
    │   ├── __init__.py
    │   ├── main.py              # FastAPI app entry, static files mount
    │   ├── core/
    │   │   ├── __init__.py
    │   │   └── config.py        # Settings (pydantic-settings)
    │   ├── api/
    │   │   ├── __init__.py
    │   │   ├── health.py        # GET /health
    │   │   └── generate.py      # POST /generate, GET /generate/{id}, GET /results/{file}
    │   ├── models/
    │   │   ├── __init__.py
    │   │   ├── graph.py         # Existing graph models (retained for Phase 2)
    │   │   └── generate.py      # GenerateRequest, GenerateResponse, TaskStatus
    │   ├── services/
    │   │   ├── __init__.py
    │   │   ├── generator.py     # LTX-Video pipeline wrapper
    │   │   └── task_manager.py  # In-memory task queue + cleanup
    │   └── static/
    │       └── index.html       # Single-page UI
    └── tests/
        ├── __init__.py
        ├── conftest.py          # Fixtures: test client, mock video, temp dir
        ├── test_health.py
        ├── test_generate.py
        ├── test_generate_task.py
        ├── test_results.py
        └── test_model.py        # Integration tests (skipped by default)
```

## 6. Dependencies

### Python packages to add to `requirements.txt`:

```
diffusers>=0.30.0
transformers>=4.44.0
accelerate>=0.33.0
torch>=2.3.0
torchvision>=0.18.0
decord>=0.6.0              # video loading
imageio>=2.35.0            # video writing
imageio-ffmpeg>=0.5.0      # ffmpeg backend for imageio
bitsandbytes>=0.44.0       # FP8 quantisation
sentencepiece>=0.2.0       # T5 tokenizer dependency
pytest>=8.0.0
pytest-asyncio>=0.24.0
httpx>=0.27.0              # TestClient for FastAPI
pytest-cov>=5.0.0
```

## 7. Success Criteria

- [ ] `GET /health` returns 200 with GPU info.
- [ ] `POST /generate` with valid video + prompt returns 202 with a task ID.
- [ ] `GET /generate/{task_id}` shows progress while generation runs.
- [ ] LTX-Video 2B generates a real video file on RTX 3080 (512x512, 25 steps) within 5 minutes.
- [ ] The web UI lets user upload, prompt, see progress, play result, and download.
- [ ] All unit tests pass (non-integration). pytest runs without GPU.
- [ ] Integration tests pass when run with `-m integration` on a machine with CUDA + model weights.
- [ ] Generation fails gracefully with a user-friendly message when VRAM is insufficient.
- [ ] End-to-end: upload a 5-second test video → generate → preview → download works on the local machine.
