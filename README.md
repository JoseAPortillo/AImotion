# AImotion

AImotion is a **desktop-first** node workflow for generating animations and video from image, video, and prompt inputs. Built with **SpecSecOps** — Spec-Driven Development with DevSecOps integrated from day one.

## Quick Start

```bash
# Backend
cd src/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# Tests
pytest -v
```

> See [docs/Plan_AImotion_EN.md](docs/Plan_AImotion_EN.md) for the full architecture, delivery phases, and SpecSecOps workflow.

## Project Structure

```
src/
├── backend/       # Python FastAPI service (sidecar)
│   ├── app/
│   │   ├── api/       # Route handlers
│   │   ├── core/      # Config, settings, dependencies
│   │   └── models/    # Pydantic data models
│   └── tests/         # pytest suites
├── frontend/       # React + React Flow node editor
├── providers/      # Cloud adapters + local runners
├── workers/        # Background execution
├── config/         # Environment examples
└── tests/          # Integration tests
```

## MVP Node Set

Image Input · Video Input · Prompt Input · Generation · Sampling Parameters · Aspect & Resolution · Audio · Output

## Documentation

| File | Audience | Purpose |
|---|---|---|
| [docs/Plan_AImotion_EN.md](docs/Plan_AImotion_EN.md) | Everyone | Product plan, architecture, SpecSecOps methodology, delivery phases |
| [docs/AGENTS.md](docs/AGENTS.md) | AI agents | Agent entry point and project rules |
| [.github/agents/aimotion.agent.md](.github/agents/aimotion.agent.md) | AI agents | Project-specific agent behavior |
| [.github/skills/aimotion-main/SKILL.md](.github/skills/aimotion-main/SKILL.md) | AI agents | Main project skill with decision gates |

## Development Methodology

**SpecSecOps** = SDD (Spec-Driven Development) + DevSecOps.

Every change follows: `Explore → Propose → Spec → Design → Tasks → Apply → Verify → Archive`.
Security requirements, threat models, and adversarial reviews are embedded in every phase — not bolted on at the end.

See the [full plan](docs/Plan_AImotion_EN.md#development-methodology-specsecops) for details.

## Key Principles

- **Desktop-first.** Tauri shell, local file access, sidecar backend.
- **Specs before code.** No implementation without an approved spec.
- **Tests are mandatory.** No test == incomplete task.
- **Adversarial review before merge.** Every PR gets a Risk + Reliability review.
- **Security in every phase.** Not a separate step.
