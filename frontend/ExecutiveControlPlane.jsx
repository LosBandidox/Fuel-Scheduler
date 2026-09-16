import React, { useEffect, useState, useRef } from "react";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";
import {
  Truck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  TrendingDown,
  Radio,
} from "lucide-react";

const API_BASE = "http://localhost:5000";

const COLORS = {
  bg: "#10141A",
  panel: "#171D24",
  panelAlt: "#1B222B",
  hairline: "#262E38",
  textPrimary: "#E7ECF0",
  textMuted: "#7E8A97",
  amber: "#F2A93B",
  teal: "#2FB8A6",
  red: "#E5484D",
};

// ---- Demo fallback data (used when the local API isn't reachable) --------
const DEMO_METRICS = {
  throughput_orders_scheduled: 4,
  schedule_adherence_pct: 80.0,
  adherence_improvement_vs_baseline_pts: 15.0,
  avg_truck_turnaround_minutes: 135.0,
  turnaround_improvement_vs_baseline_pct: 43.8,
  estimated_kes_saved_demurrage: 20000,
  events_auto_resolved: 0,
};

// Fallback trend (illustrative only) used when /metrics/trend can't be reached
// or hasn't accumulated any points yet.
const DEMO_TREND = [72, 75, 74, 78, 76, 82, 80];

// Fallback feed used when /events/feed can't be reached.
const DEMO_FEED = [
  { time: "08:15", type: "dispatch", text: "O-103 assigned to T-01, on schedule" },
  { time: "08:15", type: "dispatch", text: "O-101 assigned to T-02, on schedule" },
  { time: "08:30", type: "dispatch", text: "O-105 assigned to T-04, on schedule" },
  { time: "08:41", type: "alert", text: "T-01 reported breakdown" },
  { time: "08:41", type: "resolved", text: "Schedule auto-rebalanced across remaining fleet" },
  { time: "09:02", type: "dispatch", text: "O-104 assigned to T-03, on schedule" },
];

function formatEventTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatKES(n) {
  return "KES " + Math.round(n).toLocaleString("en-KE");
}

function useLiveMetrics() {
  const [metrics, setMetrics] = useState(DEMO_METRICS);
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/metrics/executive`, {
          signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) throw new Error("bad response");
        const data = await res.json();
        if (!cancelled) {
          setMetrics(data);
          setConnected(true);
          setLastUpdated(new Date());
        }
      } catch (e) {
        if (!cancelled) {
          setConnected(false);
        }
      }
    }

    poll();
    const id = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { metrics, connected, lastUpdated };
}

function useEventFeed() {
  const [feed, setFeed] = useState(DEMO_FEED);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/events/feed?limit=8`, {
          signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) throw new Error("bad response");
        const data = await res.json();
        if (!cancelled) {
          // Only switch to real data once the log actually has entries --
          // an empty-but-reachable API shouldn't blank out the demo feed.
          if (data.events && data.events.length > 0) {
            setFeed(data.events.map((e) => ({ time: formatEventTime(e.time), type: e.type, text: e.text })));
            setLive(true);
          }
        }
      } catch (e) {
        if (!cancelled) setLive(false);
      }
    }

    poll();
    const id = setInterval(poll, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { feed, live };
}

function useTrend() {
  const [trend, setTrend] = useState(DEMO_TREND);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/metrics/trend?limit=20`, {
          signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) throw new Error("bad response");
        const data = await res.json();
        if (!cancelled && data.history && data.history.length > 0) {
          setTrend(data.history.map((h) => h.schedule_adherence_pct));
          setLive(true);
        }
      } catch (e) {
        if (!cancelled) setLive(false);
      }
    }

    poll();
    const id = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { trend, live };
}

function RingGauge({ pct, size = 108 }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - clamped / 100);
  const color = clamped >= 90 ? COLORS.teal : clamped >= 70 ? COLORS.amber : COLORS.red;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={COLORS.hairline}
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text
        x="50%"
        y="47%"
        textAnchor="middle"
        fill={COLORS.textPrimary}
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600 }}
      >
        {clamped.toFixed(0)}%
      </text>
      <text
        x="50%"
        y="64%"
        textAnchor="middle"
        fill={COLORS.textMuted}
        style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 10 }}
      >
        on schedule
      </text>
    </svg>
  );
}

function PipelineSchematic() {
  return (
    <svg width="100%" height="64" viewBox="0 0 320 64" preserveAspectRatio="xMidYMid meet">
      <defs>
        <style>{`
          @keyframes flowDash {
            to { stroke-dashoffset: -24; }
          }
          .flow-line {
            stroke-dasharray: 6 6;
            animation: flowDash 1.2s linear infinite;
          }
        `}</style>
      </defs>
      <line x1="24" y1="32" x2="296" y2="32" stroke={COLORS.hairline} strokeWidth="3" />
      <line
        x1="24"
        y1="32"
        x2="296"
        y2="32"
        stroke={COLORS.teal}
        strokeWidth="3"
        className="flow-line"
      />
      <circle cx="24" cy="32" r="7" fill={COLORS.bg} stroke={COLORS.amber} strokeWidth="2.5" />
      <circle cx="160" cy="32" r="5" fill={COLORS.teal} />
      <circle cx="296" cy="32" r="7" fill={COLORS.bg} stroke={COLORS.teal} strokeWidth="2.5" />
      <text x="24" y="52" textAnchor="middle" fill={COLORS.textMuted} fontSize="10" fontFamily="'Space Grotesk', sans-serif">
        Refinery
      </text>
      <text x="160" y="14" textAnchor="middle" fill={COLORS.textMuted} fontSize="10" fontFamily="'Space Grotesk', sans-serif">
        In transit
      </text>
      <text x="296" y="52" textAnchor="middle" fill={COLORS.textMuted} fontSize="10" fontFamily="'Space Grotesk', sans-serif">
        Depots
      </text>
    </svg>
  );
}

function MetricPanel({ label, value, sublabel, trendPct, icon: Icon }) {
  const positive = trendPct !== undefined && trendPct >= 0;
  return (
    <div
      style={{
        padding: "20px 22px",
        borderRight: `1px solid ${COLORS.hairline}`,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon size={15} color={COLORS.textMuted} />
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, color: COLORS.textMuted }}>
          {label}
        </span>
      </div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 26,
          fontWeight: 600,
          color: COLORS.textPrimary,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, minHeight: 16 }}>
        {trendPct !== undefined && (
          <>
            {positive ? (
              <TrendingUp size={13} color={COLORS.teal} />
            ) : (
              <TrendingDown size={13} color={COLORS.red} />
            )}
            <span
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 12,
                color: positive ? COLORS.teal : COLORS.red,
              }}
            >
              {Math.abs(trendPct).toFixed(1)}
              {typeof trendPct === "number" && Math.abs(trendPct) < 1000 ? "" : ""}
              {sublabel}
            </span>
          </>
        )}
        {trendPct === undefined && sublabel && (
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, color: COLORS.textMuted }}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

function FeedIcon({ type }) {
  if (type === "alert") return <AlertTriangle size={14} color={COLORS.red} />;
  if (type === "resolved") return <CheckCircle2 size={14} color={COLORS.teal} />;
  if (type === "unassigned") return <AlertTriangle size={14} color={COLORS.amber} />;
  return <Truck size={14} color={COLORS.textMuted} />;
}

export default function ExecutiveControlPlane() {
  const { metrics, connected, lastUpdated } = useLiveMetrics();
  const { trend, live: trendLive } = useTrend();
  const { feed, live: feedLive } = useEventFeed();

  const trendData = trend.map((v, i) => ({ i, v }));

  return (
    <div
      style={{
        background: COLORS.bg,
        color: COLORS.textPrimary,
        minHeight: "100%",
        fontFamily: "'Space Grotesk', sans-serif",
        padding: 0,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
      `}</style>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 24px 40px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 24,
            paddingBottom: 20,
            borderBottom: `1px solid ${COLORS.hairline}`,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Executive Control Plane
            </h1>
            <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "6px 0 0", maxWidth: 420 }}>
              Live view of fuel batch truck scheduling across the depot network.
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
              <Radio size={13} color={connected ? COLORS.teal : COLORS.amber} />
              <span style={{ fontSize: 12, color: connected ? COLORS.teal : COLORS.amber }}>
                {connected ? "Live" : "Demo data"}
              </span>
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
              Updated {lastUpdated.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>

        {/* Hero: KES saved + pipeline schematic */}
        <div
          style={{
            display: "flex",
            gap: 32,
            alignItems: "center",
            background: COLORS.panel,
            border: `1px solid ${COLORS.hairline}`,
            padding: "26px 28px",
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 260px" }}>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 8 }}>
              KES saved in demurrage
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 44,
                fontWeight: 600,
                color: COLORS.amber,
                lineHeight: 1,
              }}
            >
              {formatKES(metrics.estimated_kes_saved_demurrage)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <TrendingUp size={14} color={COLORS.teal} />
              <span style={{ fontSize: 13, color: COLORS.teal }}>
                {metrics.turnaround_improvement_vs_baseline_pct?.toFixed(1)}% faster turnaround vs. manual dispatch baseline
              </span>
            </div>
          </div>
          <div style={{ flex: "1 1 260px", minWidth: 240 }}>
            <PipelineSchematic />
          </div>
        </div>

        {/* Metric strip */}
        <div
          style={{
            display: "flex",
            background: COLORS.panel,
            border: `1px solid ${COLORS.hairline}`,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              padding: "20px 22px",
              borderRight: `1px solid ${COLORS.hairline}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 8 }}>
              Schedule adherence
            </span>
            <RingGauge pct={metrics.schedule_adherence_pct} size={92} />
          </div>

          <MetricPanel
            label="Avg. truck turnaround"
            value={`${Math.round(metrics.avg_truck_turnaround_minutes)}m`}
            trendPct={metrics.turnaround_improvement_vs_baseline_pct}
            sublabel=" vs. baseline"
            icon={Clock}
          />
          <MetricPanel
            label="Orders scheduled"
            value={metrics.throughput_orders_scheduled}
            sublabel="this run"
            icon={Truck}
          />
          <div style={{ padding: "20px 22px", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <CheckCircle2 size={15} color={COLORS.textMuted} />
              <span style={{ fontSize: 13, color: COLORS.textMuted }}>Auto-resolved events</span>
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 26,
                fontWeight: 600,
              }}
            >
              {metrics.events_auto_resolved}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 6 }}>
              rescheduled without manual dispatch
            </div>
          </div>
        </div>

        {/* Trend + feed */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div
            style={{
              flex: "2 1 420px",
              background: COLORS.panel,
              border: `1px solid ${COLORS.hairline}`,
              padding: "20px 22px",
            }}
          >
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 4 }}>
              Adherence trend, recent runs
            </div>
            <div style={{ fontSize: 11, color: trendLive ? COLORS.teal : COLORS.amber, marginBottom: 10 }}>
              {trendLive ? "Live history from the scheduler" : "Demo data -- run the API to see real history"}
            </div>
            <div style={{ height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <YAxis hide domain={[50, 100]} />
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.teal} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={COLORS.teal} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={COLORS.teal}
                    strokeWidth={2}
                    fill="url(#trendFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div
            style={{
              flex: "1 1 260px",
              background: COLORS.panel,
              border: `1px solid ${COLORS.hairline}`,
              padding: "20px 22px",
              maxHeight: 190,
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: COLORS.textMuted }}>Dispatch feed</span>
              <span style={{ fontSize: 10.5, color: feedLive ? COLORS.teal : COLORS.amber }}>
                {feedLive ? "live" : "demo"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {feed.map((entry, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ marginTop: 2 }}>
                    <FeedIcon type={entry.type} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: COLORS.textPrimary, lineHeight: 1.4 }}>
                      {entry.text}
                    </div>
                    <div
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10.5,
                        color: COLORS.textMuted,
                        marginTop: 2,
                      }}
                    >
                      {entry.time}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: `1px solid ${COLORS.hairline}`,
            fontSize: 11,
            color: COLORS.textMuted,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Apex Innovators, KPC Inuka Fellowship Hackathon 3</span>
          <span>Domain 2, Automated Dispatch &amp; Fleet Scheduling</span>
        </div>
      </div>
    </div>
  );
}
