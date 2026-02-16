import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  TrendingUp,
  Users,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { fetchProjectInsights } from "@/lib/api";
import { useProjectStore } from "@/store/project";

const RANGE_OPTIONS = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
] as const;

export function InsightsPage() {
  const projectId = useProjectStore((s) => s.activeProjectId);
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["insights", projectId, days],
    queryFn: () => fetchProjectInsights(projectId!, days),
    enabled: Boolean(projectId),
  });

  if (!projectId) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        Select a project to view insights.
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Annotation Insights
          </h1>
          <p className="text-sm text-muted-foreground">
            Annotation activity, team performance, and review stats.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                days === opt.value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
              onClick={() => setDays(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading insights…</div>
      )}

      {data && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
              label="Approved"
              value={data.total_approved}
            />
            <StatCard
              icon={<ShieldX className="h-4 w-4 text-red-400" />}
              label="Rejected"
              value={data.total_rejected}
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4 text-sky-400" />}
              label="Total Reviewed"
              value={data.total_reviewed}
            />
            <StatCard
              icon={<Users className="h-4 w-4 text-violet-400" />}
              label="Rejection Rate"
              value={`${(data.rejection_rate * 100).toFixed(1)}%`}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="Annotations Created / Day">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.annotations_per_day}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Images Worked On / Day">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.images_completed_per_day}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Per-user bar chart */}
          {data.user_stats.length > 0 && (
            <ChartCard title="Annotations by User">
              <ResponsiveContainer width="100%" height={Math.max(180, data.user_stats.length * 40)}>
                <BarChart
                  data={data.user_stats.map((u) => ({
                    name: u.email ?? u.user_id.slice(0, 8),
                    created: u.annotations_created,
                    updated: u.annotations_updated,
                    deleted: u.annotations_deleted,
                  }))}
                  layout="vertical"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="created" stackId="a" fill="#38bdf8" name="Created" />
                  <Bar dataKey="updated" stackId="a" fill="#a78bfa" name="Updated" />
                  <Bar dataKey="deleted" stackId="a" fill="#f87171" name="Deleted" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </>
      )}
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}
