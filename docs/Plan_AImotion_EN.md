# AImotion Plan

AImotion will be built as a web-first node workflow for generating animations and video plans from image, video, and prompt inputs. The MVP keeps the system modular monolithic, backed by the backend, and focused on a clear execution pipeline rather than a complex editor.

## Product Goal

Deliver a node-based workflow where users can connect input, generation, audio, and output nodes to preview and export short animation results. The MVP must support local preview, a decoupled backend, and a provider layer that can later switch between cloud and local execution.

## Core Architecture

| Layer | Decision | Purpose |
|---|---|---|
| Frontend | React with React Flow or Litegraph.js | Render and edit the node graph, capture the workflow JSON, and show preview/export states |
| Backend | **Python** with FastAPI and a modular monolith structure | Validate the graph, resolve execution order, and expose workflow APIs |
| Asynchronous Execution | Celery + Redis | Run long jobs without blocking HTTP requests |
| Worker / Provider Layer | Cloud APIs and local bridges such as ComfyUI or Ollama | Execute generation tasks through interchangeable providers |
| Media Processing | FFmpeg | Merge video and audio before preview or export |

### Execution Layer (Worker / AI Providers)

- **Cloud:** API clients that connect to endpoints from Kling, Stability AI, etc.
- **Local (critical recommendation for the MVP):** instead of building a native installer from scratch, expose a local API using **Ollama** or **ComfyUI (in API mode)**. Let those tools handle VRAM management at this stage.

### Architectural Rules

- Keep the MVP web-first and backend-driven.
- Treat the UI as a graph editor, not as the place where heavy AI processing happens.
- Prefer REST for the first version unless the UI composition clearly requires another API style.
- Keep provider adapters replaceable so the generation node can switch execution targets later.
- Keep local preview in the MVP, even if the final generation happens in a worker or provider bridge.
- Apply DevSecOps from the start: security integrated into the development cycle, automated checks, secrets management, access control, and observability as part of the normal flow.

## MVP Node Set

| Node | Responsibility | MVP Behavior |
|---|---|---|
| Image Input | Accept a single image or an image sequence | Load the first frame and continue by consecutive numbering, or accept a ZIP file to handle frame batches |
| Video Input | Accept a source video file | Provide a video base for the generation flows |
| Prompt Input | Accept textual guidance | Feed text into the generation |
| Generation | Execute the selected provider with model parameters | Resolve provider, model, and generation parameters; adapt inputs dynamically based on what is connected |
| Audio | Attach an audio track | Pass the audio for later muxing |
| Output | Preview and export the final result | Merge audio and video, and export MP4 or GIF |

### Node Behavior Notes

- Input nodes should use dynamic ports or mutable inputs so the generation node can adapt when image, video, or prompt data is present.
- The image input node should avoid file-by-file upload for long sequences; ZIP upload is the safest option for the web MVP.
- The output node must not assume the audio is already embedded in the generated video; muxing must happen in the backend.

## Workflow Contract

The frontend sends a graph description to the backend. The backend validates the graph, resolves node order, and dispatches the execution plan.

```json
{
  "graph_id": "workflow_test_01",
  "nodes": [
    { "id": "n1", "type": "image_input", "data": { "url": "storage/user_cache/frame_0001.png" } },
    { "id": "n2", "type": "prompt_input", "data": { "text": "Cinematic sci-fi motion, cyberpunk city, 4k" } },
    { "id": "n3", "type": "generation_dit", "data": { "provider": "kling", "steps": 25, "cfg": 7.5 } },
    { "id": "n4", "type": "output_video", "data": { "format": "mp4", "resolution": "1080p" } }
  ],
  "edges": [
    { "source": "n1", "sourceOutput": "image", "target": "n3", "targetInput": "init_image" },
    { "source": "n2", "sourceOutput": "text", "target": "n3", "targetInput": "prompt" },
    { "source": "n3", "sourceOutput": "video_raw", "target": "n4", "targetInput": "video_in" }
  ]
}
```

## Delivery Phases

| Phase | Focus | Main Output | Exit Criteria |
|---|---|---|---|
| Phase 1 | Core app and graph engine | Working editor, workflow JSON, simulated generation, and preview path | The user can connect nodes, run a preview, and receive a test video |
| Phase 2 | Cloud-first execution and file handling | Async jobs, cloud provider integration, ZIP/video ingestion | The user can submit real inputs and get a generated result from an external provider |
| Phase 3 | Audio, export, and local bridging | FFmpeg muxing, output export, ComfyUI/Ollama bridge, model manager UI | The user can combine image/video + prompt + audio and export the final media |

### Phase 1 Details

- Set up the frontend node editor and the FastAPI backend.
- Add the workflow execution endpoint and graph validation rules.
- Simulate generation with a static test clip and an artificial delay.
- Focus this phase on proving that the graph contract and node order are correct.

### Phase 2 Details

- Introduce Celery and Redis for background execution.
- Add progress reporting through polling or WebSockets.
- Support temporary storage for large media uploads.
- Connect the generation node to a cloud provider such as Replicate or Stability AI.

### Phase 3 Details

- Add FFmpeg-based muxing for audio and video.
- Add export controls for MP4 and GIF.
- Add a provider selector that can point to cloud or local bridges.
- Expose a lightweight model manager so local and remote providers can be configured without changing the graph editor.

## Technical Scope Boundaries

### In Scope

- Node editor for the six core MVP nodes.
- Backend orchestration and validation.
- Simulated execution, then cloud execution, then local bridge support.
- Preview and export flow.
- Basic model and provider management.

### Out of Scope

- Marketplace features.
- Advanced automation or fully autonomous flows.
- Desktop installer complexity in the first MVP.
- Heavy editor features that are not required to validate the workflow.

## Risks and Assumptions

| Risk | Mitigation |
|---|---|
| Long-running generation blocks the UI | Use asynchronous jobs with progress reporting |
| Long image sequences are painful to upload one by one | Support ZIP-based sequence ingestion |
| The AI provider does not handle audio/video synchronization | Use FFmpeg in the backend for muxing |
| Local execution becomes too complex too early | Connect local APIs instead of building a native installer first |
| The attack surface grows as APIs, queues, and providers are exposed | Apply DevSecOps: static analysis, dependency review, secrets outside the codebase, and endpoint hardening |

## Suggested Team Split

| Role | Main Responsibility |
|---|---|
| Frontend Developer | Node editor, preview states, upload UX, export UI |
| Backend Developer | Graph validation, orchestration, queue handling, provider adapters |
| AI / DevOps Engineer | Provider configuration, local bridges, multimedia tooling, environment preparation |

## Final Recommendation

Build the MVP as a web-first modular monolith with a REST backend, asynchronous execution, and a provider abstraction layer. First validate the node graph, then add cloud generation, and finally incorporate audio muxing and bridging to local providers.