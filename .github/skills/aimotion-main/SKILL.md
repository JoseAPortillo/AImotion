---
name: aimotion-main
description: "Trigger: AImotion, AImotion MVP, node workflow, image video prompt, model manager. Main project skill for planning and implementation decisions."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Load this skill for any AImotion planning, architecture, implementation, or review task. Use it as the project-wide source of truth for MVP scope and technical direction.

## Current Plan Summary

- AImotion is a web-first node workflow for animation and video planning.
- The system is a modular monolith with a decoupled backend.
- The MVP covers image, video, prompt, generation, audio, and output nodes.
- The execution layer must support cloud providers and local API bridges such as Ollama or ComfyUI.
- DevSecOps is a first-class concern: security checks, secrets management, access control, and observability are part of the normal development flow.

## Hard Rules

- Keep the product web-first.
- Use a modular monolith with a decoupled backend.
- Treat the MVP as a node workflow for image, video, prompt, generation, audio, and output.
- Keep local preview in the MVP.
- Include the model manager in the MVP.
- Prefer REST for the MVP; defer GraphQL unless UI composition clearly needs it.
- Use Celery + Redis for long-running jobs instead of blocking HTTP requests.
- Do not expand into marketplace, advanced automation, or editor complexity without explicit approval.
- For image sequences, read from the first frame and continue by consecutive numbering.

## Execution Layer Rules

- Cloud providers should connect through API clients to services such as Kling and Stability AI.
- Local execution should use API bridges such as Ollama or ComfyUI in API mode.
- Do not build a native local installer before the MVP proves the provider abstraction.
- Keep provider adapters replaceable so execution targets can change without redesigning the graph editor.

## Non-Negotiable Controls

- Apply DevSecOps from the start.
- Validate the workflow graph before execution.
- Make the image sequence flow efficient for web usage; do not rely on one-file-at-a-time uploads for long sequences.
- Keep scope focused on the six core MVP nodes and avoid marketplace or advanced automation features.

## Decision Gates

| Question | Default choice | Escalate when |
|---|---|---|
| API style | REST | UI needs heavy data composition or query aggregation |
| Preview mode | Local | A remote pipeline becomes a product requirement |
| Scope | MVP-first | A change adds non-MVP platform complexity |
| Model support | Local + cloud manager | A provider requires new integration contracts |
| Execution target | Cloud + local bridges | A native installer becomes a product requirement |
| Security posture | DevSecOps by default | Never; security is not optional |

## Execution Steps

1. Define the node data contract before building UI behavior.
2. Separate presentation, execution, and provider adapters.
3. Implement the MVP nodes as isolated, replaceable units.
4. Wire the model manager without blocking the main generation flow.
5. Add local preview, export, and FFmpeg muxing with basic resource management.
6. Add async execution with Celery + Redis for long-running jobs.
7. Stop after the MVP boundary unless the user explicitly expands scope.

## Output Contract

Return concise, implementation-ready output. State the chosen scope, affected nodes, API style, preview mode, execution target, and any dependency on model provider integration. Call out any assumption that could change the architecture. Mention DevSecOps implications when relevant.

## References

- [Plan_AImotion_EN.md](../../../Plan_AImotion_EN.md)