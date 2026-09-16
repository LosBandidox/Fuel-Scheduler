"""
Basic test suite. Run with: python -m pytest test_scheduler.py -v
(or python test_scheduler.py if pytest isn't available)
"""

from sample_data import fresh_dataset
from scheduler import build_schedule, handle_event


def test_schedule_produces_assignments():
    batches, trucks, orders = fresh_dataset()
    result = build_schedule(batches, trucks, orders)
    assert len(result.assignments) > 0, "Scheduler should assign at least one order"


def test_no_double_booking_of_truck_at_same_time():
    """A truck should never have two overlapping assignments."""
    batches, trucks, orders = fresh_dataset()
    result = build_schedule(batches, trucks, orders)

    by_truck = {}
    for a in result.assignments:
        by_truck.setdefault(a.truck_id, []).append(a)

    for truck_id, assignments in by_truck.items():
        assignments.sort(key=lambda a: a.estimated_load_time)
        for i in range(len(assignments) - 1):
            assert assignments[i].estimated_delivery_time <= assignments[i + 1].estimated_load_time, \
                f"{truck_id} has overlapping assignments"


def test_no_batch_over_allocated():
    """Total volume drawn from a batch should never exceed its starting volume."""
    batches, trucks, orders = fresh_dataset()
    result = build_schedule(batches, trucks, orders)

    by_batch = {}
    for a in result.assignments:
        by_batch[a.batch_id] = by_batch.get(a.batch_id, 0) + a.volume_litres

    batch_capacity = {b.batch_id: b.volume_litres for b in batches}
    for batch_id, allocated in by_batch.items():
        assert allocated <= batch_capacity[batch_id], f"{batch_id} over-allocated"


def test_event_breakdown_removes_truck_from_service():
    batches, trucks, orders = fresh_dataset()
    build_schedule(batches, trucks, orders)
    handle_event("breakdown", "T-01", 0, batches, trucks, orders)

    t01 = next(t for t in trucks if t.truck_id == "T-01")
    assert t01.status == "broken_down"


def test_event_delay_pushes_availability():
    batches, trucks, orders = fresh_dataset()
    original_time = next(t for t in trucks if t.truck_id == "T-02").available_from
    handle_event("truck_delay", "T-02", 60, batches, trucks, orders)

    t02 = next(t for t in trucks if t.truck_id == "T-02")
    assert (t02.available_from - original_time).total_seconds() == 3600


def test_unknown_event_type_raises():
    batches, trucks, orders = fresh_dataset()
    try:
        handle_event("nonsense", "T-01", 0, batches, trucks, orders)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_event_log_and_trend_via_api():
    """
    app.py owns the event log / trend history (not scheduler.py), so this
    exercises it through the Flask test client rather than importing state
    directly -- keeps the test honest about what a real client would see.
    """
    import app as app_module
    app_module.reset_state()
    client = app_module.app.test_client()

    # No schedule run yet -> feed/trend should be empty, not error
    resp = client.get("/events/feed")
    assert resp.status_code == 200
    assert resp.get_json()["events"] == []

    resp = client.get("/metrics/trend")
    assert resp.status_code == 200
    assert resp.get_json()["history"] == []

    # First run should log dispatch entries and one trend point
    client.post("/schedule/run")
    feed = client.get("/events/feed").get_json()["events"]
    assert len(feed) > 0
    assert all(e["type"] == "dispatch" for e in feed)

    trend = client.get("/metrics/trend").get_json()["history"]
    assert len(trend) == 1

    # An event should add alert + resolved entries and a second trend point
    client.post("/schedule/event", json={"type": "breakdown", "entity_id": "T-01", "delay_minutes": 0})
    feed_after = client.get("/events/feed").get_json()["events"]
    types_after = {e["type"] for e in feed_after}
    assert "alert" in types_after
    assert "resolved" in types_after

    trend_after = client.get("/metrics/trend").get_json()["history"]
    assert len(trend_after) == 2


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    passed, failed = 0, 0
    for t in tests:
        try:
            t()
            print(f"PASS: {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL: {t.__name__} -- {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
