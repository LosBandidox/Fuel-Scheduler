"""
Dispatch API for the Fuel Batch Truck Scheduling engine.

Endpoints:
  GET  /health                -> liveness check for monitoring/alerting
  POST /schedule/run          -> (re)run the optimizer from current state
  GET  /schedule/current      -> current assignment plan
  POST /schedule/event        -> report a disruption, triggers auto re-optimization
  GET  /metrics/executive     -> business-facing metrics for the exec dashboard
  GET  /events/feed           -> recent dispatch/alert/resolution log (for the live feed panel)
  GET  /metrics/trend         -> historical snapshots of key metrics (for the trend chart)

Run locally:
  python app.py
Then:
  curl http://localhost:5000/health
  curl -X POST http://localhost:5000/schedule/run
  curl http://localhost:5000/schedule/current
  curl http://localhost:5000/events/feed
  curl http://localhost:5000/metrics/trend
  curl -X POST http://localhost:5000/schedule/event -H "Content-Type: application/json" \
       -d '{"type": "breakdown", "entity_id": "T-01", "delay_minutes": 0}'
"""

from flask import Flask, jsonify, request
from datetime import datetime
from collections import deque
import logging
import os

from scheduler import build_schedule, handle_event, ScheduleResult
from sample_data import fresh_dataset

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("dispatch-api")

# --- CORS ---------------------------------------------------------------
# The exec dashboard runs on a different origin than this API, so it needs
# CORS headers to fetch from the browser. Hand-rolled here (no flask-cors
# dependency needed) -- restrict ALLOWED_ORIGIN via env var in production
# rather than leaving it as "*".
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/<path:_any>", methods=["OPTIONS"])
def cors_preflight(_any):
    return "", 204


# --- In-memory state (swap for Postgres in real deployment) ---------------
# NOTE: deques are used as simple bounded ring buffers so a long-running
# process doesn't grow memory unbounded. In production, persist these to
# Postgres/a time-series store instead so history survives a restart.
EVENT_LOG_MAXLEN = 200
TREND_HISTORY_MAXLEN = 500

state = {}


def reset_state():
    batches, trucks, orders = fresh_dataset()
    state["batches"] = batches
    state["trucks"] = trucks
    state["orders"] = orders
    state["last_result"] = None
    state["events_auto_resolved"] = 0
    state["event_log"] = deque(maxlen=EVENT_LOG_MAXLEN)
    state["adherence_history"] = deque(maxlen=TREND_HISTORY_MAXLEN)
    state["previously_assigned_order_ids"] = set()


reset_state()

# --- Baseline for ROI comparison (pre-system manual-dispatch estimate) ----
BASELINE_AVG_TURNAROUND_MIN = 240      # manual/spreadsheet baseline, replace with real historical avg
BASELINE_SCHEDULE_ADHERENCE_PCT = 65   # manual/spreadsheet baseline
DEMURRAGE_RATE_KES_PER_HOUR = 5000     # replace with actual contractual penalty rate


def assignment_to_dict(a):
    return {
        "order_id": a.order_id,
        "truck_id": a.truck_id,
        "batch_id": a.batch_id,
        "volume_litres": a.volume_litres,
        "estimated_load_time": a.estimated_load_time.isoformat(),
        "estimated_delivery_time": a.estimated_delivery_time.isoformat(),
        "on_time": a.on_time,
        "lateness_minutes": a.lateness_minutes,
    }


def result_to_dict(result: ScheduleResult):
    return {
        "generated_at": result.generated_at.isoformat(),
        "summary": result.summary(),
        "assignments": [assignment_to_dict(a) for a in result.assignments],
        "unassigned_orders": [o.order_id for o in result.unassigned_orders],
    }


# ---------------------------------------------------------------------------
# Event log
# ---------------------------------------------------------------------------

def log_event(event_type: str, text: str):
    """
    Append an entry to the live event log. `event_type` drives the icon in
    the dashboard feed: 'dispatch' | 'alert' | 'resolved' | 'unassigned'.
    """
    entry = {
        "time": datetime.utcnow().isoformat(),
        "type": event_type,
        "text": text,
    }
    state["event_log"].append(entry)
    return entry


def log_dispatch_diff(result: ScheduleResult):
    """
    Compare the new result against the previously known assignment state and
    log real dispatch/unassigned entries only for what actually changed --
    this keeps the feed meaningful (one line per real event) instead of
    re-logging the entire schedule on every run.
    """
    new_assigned_ids = {a.order_id: a for a in result.assignments}
    previously_assigned = state["previously_assigned_order_ids"]

    for order_id, a in new_assigned_ids.items():
        if order_id not in previously_assigned:
            status = "on schedule" if a.on_time else f"running {a.lateness_minutes:.0f}m late"
            log_event("dispatch", f"{order_id} assigned to {a.truck_id}, {status}")

    newly_unassigned = previously_assigned - set(new_assigned_ids.keys())
    for order_id in newly_unassigned:
        log_event("unassigned", f"{order_id} could not be assigned -- no truck/batch available")

    state["previously_assigned_order_ids"] = set(new_assigned_ids.keys())


def record_trend_snapshot(metrics: dict):
    """Append a timestamped snapshot of the key business metrics for the trend chart."""
    state["adherence_history"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "schedule_adherence_pct": metrics["schedule_adherence_pct"],
        "estimated_kes_saved_demurrage": metrics["estimated_kes_saved_demurrage"],
        "avg_truck_turnaround_minutes": metrics["avg_truck_turnaround_minutes"],
    })


def compute_executive_metrics(result: ScheduleResult) -> dict:
    """Shared logic for /metrics/executive and trend snapshots, so both stay in sync."""
    s = result.summary()

    if result.assignments:
        avg_turnaround_min = sum(
            (a.estimated_delivery_time - a.estimated_load_time).total_seconds() / 60
            for a in result.assignments
        ) / len(result.assignments)
    else:
        avg_turnaround_min = 0

    turnaround_improvement_pct = round(
        100 * (BASELINE_AVG_TURNAROUND_MIN - avg_turnaround_min) / BASELINE_AVG_TURNAROUND_MIN, 1
    ) if BASELINE_AVG_TURNAROUND_MIN else 0

    adherence_improvement_pts = round(s["schedule_adherence_pct"] - BASELINE_SCHEDULE_ADHERENCE_PCT, 1)

    total_late_hours = sum(a.lateness_minutes for a in result.assignments) / 60
    baseline_late_orders = round(s["total_orders"] * (1 - BASELINE_SCHEDULE_ADHERENCE_PCT / 100))
    baseline_late_hours_est = baseline_late_orders * 2  # assume 2h avg overrun per late order at baseline
    hours_saved = max(0, baseline_late_hours_est - total_late_hours)
    kes_saved_demurrage = round(hours_saved * DEMURRAGE_RATE_KES_PER_HOUR)

    return {
        "throughput_orders_scheduled": s["assigned"],
        "schedule_adherence_pct": s["schedule_adherence_pct"],
        "adherence_improvement_vs_baseline_pts": adherence_improvement_pts,
        "avg_truck_turnaround_minutes": round(avg_turnaround_min, 1),
        "turnaround_improvement_vs_baseline_pct": turnaround_improvement_pct,
        "estimated_kes_saved_demurrage": kes_saved_demurrage,
        "events_auto_resolved": state["events_auto_resolved"],
        "note": "Baseline figures are placeholders -- replace with real historical KPC dispatch data before presenting.",
    }


@app.route("/health")
def health():
    return jsonify({"status": "ok", "time": datetime.utcnow().isoformat()})


@app.route("/schedule/run", methods=["POST"])
def run_schedule():
    result = build_schedule(state["batches"], state["trucks"], state["orders"])
    state["last_result"] = result
    log.info("Schedule run: %s", result.summary())

    log_dispatch_diff(result)
    metrics = compute_executive_metrics(result)
    record_trend_snapshot(metrics)

    return jsonify(result_to_dict(result))


@app.route("/schedule/current")
def current_schedule():
    if state["last_result"] is None:
        return jsonify({"error": "No schedule has been run yet. POST /schedule/run first."}), 404
    return jsonify(result_to_dict(state["last_result"]))


@app.route("/schedule/event", methods=["POST"])
def schedule_event():
    payload = request.get_json(force=True)
    event_type = payload.get("type")
    entity_id = payload.get("entity_id")
    delay_minutes = payload.get("delay_minutes", 0)

    if event_type not in ("truck_delay", "batch_delay", "breakdown"):
        return jsonify({"error": f"Unknown event type: {event_type}"}), 400

    try:
        result = handle_event(event_type, entity_id, delay_minutes,
                               state["batches"], state["trucks"], state["orders"])
    except Exception as e:
        log.exception("Event handling failed")
        return jsonify({"error": str(e)}), 500

    state["last_result"] = result
    state["events_auto_resolved"] += 1

    # Log the disruption itself, then re-run the dispatch diff so the feed
    # shows what actually moved as a result of the re-optimization.
    _EVENT_DESCRIPTIONS = {
        "truck_delay": f"Truck {entity_id} reported delayed by {delay_minutes}m",
        "batch_delay": f"Batch {entity_id} reported delayed by {delay_minutes}m",
        "breakdown": f"Truck {entity_id} reported breakdown",
    }
    log_event("alert", _EVENT_DESCRIPTIONS[event_type])
    log_dispatch_diff(result)

    metrics = compute_executive_metrics(result)
    record_trend_snapshot(metrics)
    log_event("resolved", f"Schedule auto-rebalanced -- adherence now {metrics['schedule_adherence_pct']}%")

    # This is where a real deployment fires the Slack/PagerDuty webhook.
    _fire_alert(event_type, entity_id, result)

    return jsonify({
        "event_processed": {"type": event_type, "entity_id": entity_id, "delay_minutes": delay_minutes},
        "new_schedule": result_to_dict(result),
    })


def _fire_alert(event_type, entity_id, result):
    """Stub for Slack/PagerDuty webhook integration. Log for now."""
    adherence = result.summary()["schedule_adherence_pct"]
    log.warning(
        "[ALERT] %s on %s -> auto-rescheduled. New adherence: %s%%",
        event_type, entity_id, adherence
    )
    # Real implementation:
    # requests.post(SLACK_WEBHOOK_URL, json={"text": f"..."})
    if adherence < 90:
        log.warning("[ALERT] Schedule adherence dropped below 90%% threshold: %s%%", adherence)


@app.route("/metrics/executive")
def executive_metrics():
    """Business-facing metrics for the Executive Control Plane dashboard."""
    if state["last_result"] is None:
        return jsonify({"error": "No schedule has been run yet."}), 404

    return jsonify(compute_executive_metrics(state["last_result"]))


@app.route("/events/feed")
def events_feed():
    """
    Recent dispatch/alert/resolution log for the dashboard's live feed panel.
    Returns newest-first. Query param `limit` caps how many entries (default 20).
    """
    limit = request.args.get("limit", default=20, type=int)
    entries = list(state["event_log"])[-limit:]
    entries.reverse()
    return jsonify({"events": entries})


@app.route("/metrics/trend")
def metrics_trend():
    """
    Historical snapshots of key business metrics, oldest-first, for the
    dashboard's trend chart. A snapshot is recorded on every /schedule/run
    and every /schedule/event. Query param `limit` caps how many points
    (default 20, most recent).
    """
    limit = request.args.get("limit", default=20, type=int)
    history = list(state["adherence_history"])[-limit:]
    return jsonify({"history": history})


if __name__ == "__main__":
    # Local dev only. In production, a WSGI server (gunicorn, see Procfile)
    # imports `app` directly and this block never runs.
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
