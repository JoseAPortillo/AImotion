import pytest
from app.services.task_manager import TaskManager, TaskStatus


@pytest.fixture
def manager():
    return TaskManager()


@pytest.mark.asyncio
async def test_task_status_pending(manager):
    task_id = await manager.create_task({"prompt": "test"})
    task = await manager.get_task(task_id)
    assert task is not None
    assert task.status == TaskStatus.PENDING


@pytest.mark.asyncio
async def test_task_status_transitions(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.set_running(task_id, 25)
    task = await manager.get_task(task_id)
    assert task.status == TaskStatus.RUNNING
    assert task.total_steps == 25

    await manager.set_progress(task_id, 10, 25)
    task = await manager.get_task(task_id)
    assert task.progress == pytest.approx(0.4)

    await manager.complete_task(task_id, "/results/test.mp4")
    task = await manager.get_task(task_id)
    assert task.status == TaskStatus.COMPLETED
    assert task.progress == 1.0


@pytest.mark.asyncio
async def test_task_status_failed(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.fail_task(task_id, "Out of memory")
    task = await manager.get_task(task_id)
    assert task.status == TaskStatus.FAILED
    assert "Out of memory" in task.error


@pytest.mark.asyncio
async def test_task_unknown_id(manager):
    task = await manager.get_task("nonexistent")
    assert task is None


@pytest.mark.asyncio
async def test_task_monotonic_progress(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.set_running(task_id, 25)
    progresses = []
    for i in range(0, 26, 5):
        await manager.set_progress(task_id, i, 25)
        task = await manager.get_task(task_id)
        progresses.append(task.progress)

    for i in range(1, len(progresses)):
        assert progresses[i] >= progresses[i - 1]


@pytest.mark.asyncio
async def test_task_to_dict(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.set_running(task_id, 25)
    await manager.set_progress(task_id, 5, 25)
    task = await manager.get_task(task_id)
    d = task.to_dict()
    assert d["task_id"] == task_id
    assert d["status"] == "running"
    assert d["progress"] == 0.2
    assert d["current_step"] == 5
    assert d["total_steps"] == 25
