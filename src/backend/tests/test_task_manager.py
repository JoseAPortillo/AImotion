import pytest
from app.services.task_manager import TaskManager, TaskStatus


@pytest.fixture
def manager():
    return TaskManager()


@pytest.mark.asyncio
async def test_create_task_creates_unique_ids(manager):
    id1 = await manager.create_task({"p": "a"})
    id2 = await manager.create_task({"p": "b"})
    assert id1 != id2


@pytest.mark.asyncio
async def test_create_task_stores_params(manager):
    task_id = await manager.create_task({"prompt": "hello", "steps": 25})
    task = await manager.get_task(task_id)
    assert task.params["prompt"] == "hello"
    assert task.params["steps"] == 25


@pytest.mark.asyncio
async def test_set_progress_without_running_sets_steps(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.set_progress(task_id, 5, 25)
    task = await manager.get_task(task_id)
    assert task.current_step == 5
    assert task.total_steps == 25


@pytest.mark.asyncio
async def test_complete_task_sets_result_url(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.complete_task(task_id, "/results/out.mp4")
    task = await manager.get_task(task_id)
    assert task.status == TaskStatus.COMPLETED
    assert task.result_url == "/results/out.mp4"


@pytest.mark.asyncio
async def test_fail_task_sets_error(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.fail_task(task_id, "something broke")
    task = await manager.get_task(task_id)
    assert task.status == TaskStatus.FAILED
    assert task.error == "something broke"


@pytest.mark.asyncio
async def test_update_task_in_place(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.update_task(task_id, progress=0.5, current_step=10)
    task = await manager.get_task(task_id)
    assert task.progress == 0.5
    assert task.current_step == 10


@pytest.mark.asyncio
async def test_update_task_nonexistent_doesnt_crash(manager):
    await manager.update_task("no-such-id", progress=0.5)
    assert True


@pytest.mark.asyncio
async def test_set_running_sets_total_steps(manager):
    task_id = await manager.create_task({"prompt": "test"})
    await manager.set_running(task_id, 50)
    task = await manager.get_task(task_id)
    assert task.status == TaskStatus.RUNNING
    assert task.total_steps == 50


@pytest.mark.asyncio
async def test_initial_progress_is_zero(manager):
    task_id = await manager.create_task({"prompt": "test"})
    task = await manager.get_task(task_id)
    assert task.progress == 0.0
    assert task.current_step is None
    assert task.total_steps is None
    assert task.result_url is None
    assert task.error is None


@pytest.mark.asyncio
async def test_to_dict_includes_all_fields(manager):
    task_id = await manager.create_task({"prompt": "test", "steps": 10})
    await manager.set_running(task_id, 10)
    await manager.set_progress(task_id, 3, 10)
    d = (await manager.get_task(task_id)).to_dict()
    assert set(d.keys()) == {
        "task_id", "status", "progress", "current_step",
        "total_steps", "eta_sec", "result_url", "error",
        "result_type",
    }
