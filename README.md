# Fuel Batch Truck Scheduler — Apex Innovators

AI-driven scheduling engine + dispatch API for matching refinery fuel batches
to trucks and delivery orders, with event-driven auto-rescheduling.

Domain 2, Problem 3 — KPC Inuka Fellowship Hackathon 3.

## What's in here

| File | Purpose |
|---|---|
| `scheduler.py` | Core engine: data model + greedy scheduling algorithm + event handling |
| `sample_data.py` | Sample dataset for testing/demo — **replace with real feeds for production** |
| `app.py` | Flask dispatch API + executive metrics endpoint |
| `test_scheduler.py` | Test suite covering the invariants that matter (no double-booking, no over-allocation, event handling) |
| `.github/workflows/ci.yml` | CI/CD pipeline: test on every push, deploy on merge to `main` |
| `requirements.txt` | Python dependencies |

## Running locally

```bash
pip install -r requirements.txt
python app.py
```

Then in another terminal:
```bash
curl http://localhost:5000/health
curl -X POST http://localhost:5000/schedule/run
curl http://localhost:5000/schedule/current
curl http://localhost:5000/metrics/executive

# Simulate a disruption and watch it auto-reschedule
curl -X POST http://localhost:5000/schedule/event \
  -H "Content-Type: application/json" \
  -d '{"type": "breakdown", "entity_id": "T-01", "delay_minutes": 0}'
```

## Running tests

```bash
python test_scheduler.py
```

## Architecture

```
Refinery batch feed ─┐
Truck/driver feed  ───┼──▶ Scheduling Engine ──▶ Assignment Store ──▶ Dispatch API ──┬──▶ Executive Dashboard
Order/delivery feed ──┘         (scheduler.py)                        (app.py)       └──▶ Alerts (Slack/PagerDuty)
```

**Algorithm:** greedy assignment sorted by delivery-window urgency, followed
by a second-chance pass that relaxes driver shift-end by a small overtime
allowance to recover otherwise-unassignable orders. See `scheduler.py`
docstrings for the upgrade path to a constraint solver (OR-Tools CP-SAT) if
more time is available.

**Event-driven re-optimization:** `POST /schedule/event` accepts
`truck_delay`, `batch_delay`, or `breakdown` and re-runs the scheduler
immediately, returning a new valid plan and firing an alert — this is the
"acts, not just shows" requirement for Stage 3.

## Deploying

**Recommended path: Render (free tier, simplest for a hackathon timeline).**

1. Push this project to a GitHub repo.
2. On [render.com](https://render.com), **New → Blueprint**, point it at your repo. Render reads `render.yaml` in this project and configures the service automatically (build command, start command, health check).
3. Once created, Render gives you a public URL like `https://fuel-batch-scheduler-api.onrender.com`. Auto-deploys on every push to `main` by default.
4. In the dashboard's `ExecutiveControlPlane.jsx`, change `API_BASE` from `http://localhost:5000` to that URL.
5. (Optional, recommended before the live demo) In Render's dashboard, add a **Deploy Hook**, copy its URL, and add it as a GitHub Actions secret named `RENDER_DEPLOY_HOOK_URL` — this lets the CI workflow gate deploys behind the test job passing, instead of Render deploying straight off every push regardless of test results.
6. Tighten `ALLOWED_ORIGIN` (currently `*`) in Render's environment variables to your dashboard's actual origin once you know where it's hosted.

**Alternative: Docker, for Fly.io/Railway/any container host.**

```bash
docker build -t fuel-batch-scheduler .
docker run -p 8080:8080 -e PORT=8080 fuel-batch-scheduler
```

`fly.toml` is included if you go with Fly.io specifically — `flyctl launch` then `flyctl deploy` after adjusting `primary_region` if a closer region becomes available.

**A note on the free-tier cold start:** Render's free plan spins down after 15 minutes idle and takes ~30-60s to wake on the next request. If your live demo has any gap before the pitch, either hit `/health` a minute beforehand to warm it up, or use Fly.io's `min_machines_running = 1` (already set in `fly.toml`) to avoid this entirely — worth the tradeoff given judges will be watching live.

## Known limitations (be upfront about these in the demo/pitch)

- **Travel times are a placeholder constant** (`estimate_travel_minutes` in
  `scheduler.py`), not a real distance/routing lookup. Swap in a real
  distance matrix or routing API before relying on this for live ops.
- **In-memory state** — restarting the API loses the current schedule, event
  log, and trend history. This matters more on Render's free tier, which
  spins the instance down on idle (see "Deploying" above) — a spin-down
  silently resets the dashboard's history. Swap `state = {}` in `app.py`
  for PostgreSQL before production use, or use `min_machines_running = 1`
  (Fly.io) / a paid Render plan to avoid idle spin-down during the demo.
- **Baseline figures in `/metrics/executive`** (`BASELINE_AVG_TURNAROUND_MIN`,
  `BASELINE_SCHEDULE_ADHERENCE_PCT`, `DEMURRAGE_RATE_KES_PER_HOUR`) are
  placeholders. Replace with real historical KPC dispatch data and actual
  contractual demurrage rates before presenting the ROI case to judges —
  the rubric explicitly checks that "assumptions are honest and backed by
  the data."
- **No auth on the API** — add an API key or JWT layer before exposing
  beyond localhost/demo.
- The local development server (`python app.py`) is not production-grade.
  Deploy behind Gunicorn/Waitress + a real host (see CI/CD workflow).

## Disaster recovery

- **State loss:** since state is in-memory (until the DB migration above),
  the recovery step is simply re-running `POST /schedule/run`, which
  rebuilds the plan from current batch/truck/order data. No data is
  permanently lost as long as the upstream feeds (refinery, fleet, orders)
  remain the source of truth.
- **Deploy failure:** the CI/CD pipeline runs tests before every deploy and
  posts to Slack on failure — a bad deploy should never reach production
  silently.
- **Rollback:** redeploy the previous known-good commit/tag via your host's
  deploy history (Render/Railway/Fly.io all support one-click rollback to a
  previous deploy).

## Handover contacts / on-call

_Fill in before handover: who's on-call, escalation path, KPC/Em-Tech IT
contact for infra access._
