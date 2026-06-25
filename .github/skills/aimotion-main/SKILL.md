---
name: aimotion-main
description: "Trigger: AImotion, AImotion MVP, node workflow, image video prompt, model manager. Main project skill for planning and implementation decisions."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "3.0"
---

## Activation Contract

Load this skill for any AImotion planning, architecture, implementation, or review task. Use it as the project-wide source of truth for MVP scope, technical direction, and phased delivery.

## Current Plan Summary

- AImotion is a **desktop-first** node workflow for animation and video generation.
- **3 pragmatic phases.** Phase 1: FastAPI + LTX-Video 2B + minimal web UI. Phase 2: Tauri + React Flow + graph editor + cloud provider. Phase 3: Audio + export + model installer + full SpecSecOps.
- Development methodology: **Lightweight SDD** (Spec → Implement → Verify) for Phase 1-2. Graduate to **SpecSecOps** in Phase 3.
- RTX 3080 reality: ≤2B params at ≤512px with FP8. LTX-Video 2B is the target local model.
- Testing: **pytest** mandatory. No test == incomplete task.
- Health: `/health` endpoint.
- Full plan: `docs/Plan_AImotion_EN.md`

## Hard Rules

- **Desktop-first.** The app is a desktop application. Phase 1 uses localhost browser as a pragmatic shortcut; Tauri comes in Phase 2.
- **Phase scope is inviolable.** Phase 1 is intentionally minimal: video upload + prompt + generate + preview. No graph editor, no Tauri, no providers, no audio.
- **Tests are mandatory.** Every backend module must have tests. Untested code does not ship. Use pytest with pytest-asyncio.
- Use a modular monolith with a decoupled backend.
- Keep local preview in the MVP from Phase 1.
- Prefer REST for the MVP; defer GraphQL unless UI composition clearly needs it.
- Use asyncio background tasks for async execution; defer Celery + Redis unless job volume justifies it.
- Do not expand into marketplace, advanced automation, or editor complexity without explicit approval.
- Generate real video in Phase 1. Simulated generation is not acceptable.

## Execution Layer Rules

- Phase 1: single local model (LTX-Video 2B via diffusers). Hardcoded pipeline. No provider abstraction.
- Phase 2: Cloud providers via API clients. Provider adapters with capabilities reporting. More local models (CogVideoX-2B).
- Phase 3: Local model installer, credential manager, reference conditioning.
- Do not build provider abstraction before Phase 2.

## Non-Negotiable Controls

- **Desktop-first architecture.** No web-first designs. No browser-only APIs.
- **Mandatory test coverage.** pytest for all backend code.
- **Phase scope discipline.** Phase 1 does not include Phase 2 or 3 features.
- Validate inputs and sanitize paths. No secrets in code.
- Keep scope focused and avoid marketplace or advanced automation features.

## Decision Gates

| Question | Default choice | Escalate when |
|---|---|---|
| Phase | Phase 1: form-based, single model, no graph | User explicitly asks for graph editor, Tauri, or cloud providers |
| Deployment model | Desktop (Phase 2: Tauri sidecar) | Phase 1 uses localhost browser pragmatically |
| Development methodology | Lightweight SDD (Phase 1-2) | User requests full SpecSecOps or project has multiple contributors |
| API style | REST | UI needs heavy data composition or query aggregation |
| Preview mode | Local | A remote pipeline becomes a product requirement |
| Model support | Single local model (Phase 1) | User requests additional models |
| Execution target | Local only (Phase 1) | User requests cloud adapter |
| Security posture | Security by default | Never; security is not optional |
| Testing | pytest, mandatory coverage | Coverage drops below 80% on core modules |

## SDD Phase References (Lightweight)

| Phase | What the agent must do |
|---|---|
| Spec | Define requirements, success criteria, and edge cases. Include security properties (input validation, secret handling). |
| Implement | Write code + tests. Safe defaults. Validate all inputs. |
| Verify | Run tests, manual smoke test, check for regressions. Confirm spec is met. |

## SDD Phase References (Full SpecSecOps — Phase 3+)

| Phase | What the agent must do |
|---|---|
| Explore | Investigate requirements. Identify security-relevant areas (file I/O, network, subprocess). |
| Propose | State scope, approach, attack surface changes, and data sensitivity. |
| Spec | Write verifiable requirements including security properties. |
| Design | Include a lightweight threat model: what can go wrong, what are we protecting. |
| Tasks | Break into testable units. Include security tasks (input sanitisation, audit logging, permission checks). |
| Apply | Implement + write tests + security controls alongside features. Safe defaults. |
| Verify | Run tests, adversarial review (Risk + Reliability), dependency scan, validate against spec. |
| Archive | Document residual risk, security decisions, and assumptions. |

## Execution Steps

1. Phase 1: Build FastAPI backend with `/health` and async `/generate` endpoint.
2. Phase 1: Integrate LTX-Video 2B with FP8 quantisation, CPU-offloaded T5-XXL.
3. Phase 1: Build minimal web UI (upload + prompt + generate + preview).
4. Phase 1: Write pytest suite for all backend modules.
5. Phase 2: Wrap in Tauri desktop shell. Add React Flow node editor.
6. Phase 2: Add graph validation, DAG execution engine, Group nodes.
7. Phase 2: Add cloud provider adapter and more local models.
8. Phase 3: Add audio conditioning, FFmpeg export, credential manager, model installer.
9. Phase 3: Graduate to full SpecSecOps methodology.
10. **Every step includes tests.** Without tests, the step is incomplete.

## Output Contract

Return concise, implementation-ready output. State:

- Phase and scope of the change
- API changes and affected endpoints
- Model/provider dependencies
- Security implications
- Test strategy for the change
- What is explicitly NOT included (scope boundaries)

## References

- [Plan_AImotion_EN.md](../../../docs/Plan_AImotion_EN.md) — Full product plan and phased delivery
- [AImotion agent](../../agents/aimotion.agent.md) — Project-specific agent behavior
