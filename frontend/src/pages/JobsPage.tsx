import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import {
  createJob,
  cancelJob,
  fetchJobs,
  fetchJobLogs,
  fetchModelArchitectures,
  fetchDatasetVersions,
  fetchTrainedModels,
  fetchGpuEstimate,
  fetchJobProgress,
  type Job,
  type JobLogEntry,
  type ModelArchInfo,
  type DatasetVersion,
  type TrainedModel,
  type GpuEstimate,
  type JobProgress,
} from "@/lib/api";
import { useProjectStore } from "@/store/project";

type LogEntry = { ts: string; line: string };

/** Debounce a value — delays updating until input settles. */
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function GpuEstimatePanel({
  estimate,
  loading,
}: {
  estimate: GpuEstimate;
  loading: boolean;
}) {
  const totalGb = estimate.total_gb;
  const barSegments = [
    { label: "Params", mb: estimate.model_params_mb, color: "bg-blue-500" },
    { label: "Optim", mb: estimate.optimizer_mb, color: "bg-violet-500" },
    { label: "Activations", mb: estimate.activation_mb, color: "bg-amber-500" },
    { label: "CUDA", mb: estimate.cuda_overhead_mb, color: "bg-gray-500" },
  ];
  const totalRaw = barSegments.reduce((s, b) => s + b.mb, 0);

  // Severity thresholds
  const severity =
    totalGb <= 10
      ? "low"
      : totalGb <= 20
        ? "medium"
        : totalGb <= 40
          ? "high"
          : "extreme";
  const severityColors = {
    low: "text-green-400 border-green-500/30 bg-green-500/5",
    medium: "text-yellow-400 border-yellow-500/30 bg-yellow-500/5",
    high: "text-orange-400 border-orange-500/30 bg-orange-500/5",
    extreme: "text-red-400 border-red-500/30 bg-red-500/5",
  };

  return (
    <div
      className={`mt-3 rounded-lg border p-3 transition-opacity ${severityColors[severity]} ${loading ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide">
          Est. GPU VRAM
        </h4>
        <span className="text-lg font-bold tabular-nums">
          {totalGb.toFixed(1)} GB
        </span>
      </div>

      {/* Stacked bar */}
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-black/30">
        {barSegments.map((seg) => (
          <div
            key={seg.label}
            className={`${seg.color} transition-all`}
            style={{ width: `${(seg.mb / totalRaw) * 100}%` }}
            title={`${seg.label}: ${(seg.mb / 1024).toFixed(1)} GB`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {barSegments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${seg.color}`} />
            {seg.label} {(seg.mb / 1024).toFixed(1)}G
          </span>
        ))}
      </div>

      {/* GPU fit badges */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {estimate.fits_gpus.map((g) => (
          <span
            key={g}
            className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400"
          >
            ✓ {g}
          </span>
        ))}
        {estimate.tight_gpus.map((g) => (
          <span
            key={g}
            className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-medium text-yellow-400"
          >
            ⚠ {g}
          </span>
        ))}
        {estimate.too_small_gpus.map((g) => (
          <span
            key={g}
            className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400"
          >
            ✗ {g}
          </span>
        ))}
      </div>

      {/* Suggestion */}
      {estimate.suggested_max_batch_16gb > 0 && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Max batch for 16 GB GPU:{" "}
          <span className="font-semibold text-foreground">
            {estimate.suggested_max_batch_16gb}
          </span>
        </p>
      )}
    </div>
  );
}

function statusBadge(status: Job["status"]) {
  const colors: Record<string, string> = {
    PENDING: "bg-yellow-500/20 text-yellow-400",
    RUNNING: "bg-blue-500/20 text-blue-400",
    COMPLETED: "bg-green-500/20 text-green-400",
    FAILED: "bg-red-500/20 text-red-400",
    CANCELLED: "bg-gray-500/20 text-gray-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? ""}`}
    >
      {status}
    </span>
  );
}

/** Format seconds to human-readable string. */
function fmtDuration(secs: number): string {
  if (secs <= 0) return "--";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Live progress bar for running training jobs. */
function JobProgressBar({
  jobId,
  jobStatus,
}: {
  jobId: string;
  jobStatus: Job["status"];
}) {
  const isLive = jobStatus === "RUNNING" || jobStatus === "PENDING";
  const [wsProgress, setWsProgress] = useState<JobProgress | null>(null);

  // Poll REST endpoint as fallback / initial load
  const { data: polledProgress } = useQuery({
    queryKey: ["job-progress", jobId],
    queryFn: () => fetchJobProgress(jobId),
    enabled: isLive,
    refetchInterval: isLive ? 5000 : false,
  });

  // WebSocket for real-time progress updates
  useEffect(() => {
    if (!isLive) return;
    const wsBase =
      import.meta.env.VITE_WS_URL ??
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/jobs/${jobId}`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.type === "progress") {
          setWsProgress(data as JobProgress);
        }
      } catch {
        /* plain log line — ignore in progress handler */
      }
    };
    return () => ws.close();
  }, [jobId, isLive]);

  const progress = wsProgress ?? polledProgress;
  if (!progress || (progress.pct === 0 && progress.phase === "pending"))
    return null;

  const pct = Math.min(progress.pct, 100);
  const phase = progress.phase;

  return (
    <div className="mt-2 space-y-1">
      {/* Bar */}
      <div className="relative h-3 overflow-hidden rounded-full bg-muted/50">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
            phase === "preparing"
              ? "bg-yellow-500/70 animate-pulse"
              : phase === "completed"
                ? "bg-green-500"
                : "bg-blue-500"
          }`}
          style={{ width: `${Math.max(pct, phase === "preparing" ? 5 : 1)}%` }}
        />
        {phase === "training" && pct > 8 && (
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow">
            {pct.toFixed(0)}%
          </span>
        )}
      </div>
      {/* Info line */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {phase === "preparing" && "Preparing dataset…"}
          {phase === "training" && (
            <>
              Epoch {progress.epoch}/{progress.total_epochs}
              {progress.batch > 0 && progress.total_batches > 0 && (
                <>
                  {" "}
                  · batch {progress.batch}/{progress.total_batches}
                </>
              )}
            </>
          )}
          {phase === "completed" && "Complete"}
        </span>
        <span className="tabular-nums">
          {progress.elapsed_secs > 0 && (
            <>{fmtDuration(progress.elapsed_secs)} elapsed</>
          )}
          {progress.eta_secs > 0 && phase === "training" && (
            <> · ~{fmtDuration(progress.eta_secs)} left</>
          )}
        </span>
      </div>
    </div>
  );
}

function JobLogViewer({
  jobId,
  channel,
  jobStatus,
}: {
  jobId: string;
  channel: string;
  jobStatus: Job["status"];
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isLive = jobStatus === "RUNNING" || jobStatus === "PENDING";

  // Always fetch historical logs on mount (covers page refresh mid-job)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJobLogs(jobId)
      .then((entries) => {
        if (!cancelled && entries.length > 0) setLogs(entries);
      })
      .catch(() => {
        if (!cancelled && !isLive)
          setLogs([
            { ts: new Date().toISOString(), line: "[failed to load logs]" },
          ]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // For running/pending: also connect WebSocket for NEW messages
  useEffect(() => {
    if (!isLive) return;
    const wsBase =
      import.meta.env.VITE_WS_URL ??
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/jobs/${jobId}`);
    ws.onmessage = (event) => {
      // Skip structured progress events — they're handled by JobProgressBar
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && parsed.type === "progress") return;
      } catch {
        /* not JSON, that's fine — it's a regular log line */
      }

      const line =
        (() => {
          try {
            return JSON.parse(event.data)?.data;
          } catch {
            return undefined;
          }
        })() ?? event.data;

      setLogs((prev) => {
        // Deduplicate: skip if the last historical entry has the same text
        if (prev.length > 0 && prev[prev.length - 1].line === line) return prev;
        return [...prev, { ts: new Date().toISOString(), line }];
      });
    };
    ws.onerror = () => {
      setLogs((prev) => [
        ...prev,
        { ts: new Date().toISOString(), line: "[connection error]" },
      ]);
    };
    return () => ws.close();
  }, [jobId, isLive]);

  return (
    <div className="mt-2 max-h-60 overflow-auto rounded border border-border bg-black/80 p-3 font-mono text-xs text-green-300">
      {loading && <span className="text-muted-foreground">Loading logs…</span>}
      {!loading && logs.length === 0 && (
        <span className="text-muted-foreground">
          {isLive ? "Waiting for logs…" : "No logs recorded."}
        </span>
      )}
      {logs.map((entry, i) => (
        <div key={i}>
          <span className="text-muted-foreground">
            {entry.ts.slice(11, 19)}{" "}
          </span>
          {entry.line}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

export function JobsPage() {
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.activeProjectId);
  const [error, setError] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // New-job form state
  const [jobType, setJobType] = useState<"train" | "predict">("train");
  const [modelArch, setModelArch] = useState("yolo11n.pt");
  const [epochs, setEpochs] = useState("30");
  const [batch, setBatch] = useState("8");
  const [imgsz, setImgsz] = useState("640");
  const [checkpoint, setCheckpoint] = useState("coco");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [modelPath, setModelPath] = useState("");
  const [customModelPath, setCustomModelPath] = useState("");

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["jobs", projectId],
    queryFn: () => fetchJobs(projectId ?? undefined),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });

  const { data: architectures } = useQuery({
    queryKey: ["model-architectures"],
    queryFn: fetchModelArchitectures,
  });

  const { data: versions } = useQuery({
    queryKey: ["versions", projectId],
    queryFn: () => fetchDatasetVersions(projectId!),
    enabled: Boolean(projectId),
  });

  const { data: trainedModels } = useQuery({
    queryKey: ["trained-models", projectId],
    queryFn: () => fetchTrainedModels(projectId!),
    enabled: Boolean(projectId),
  });

  // GPU VRAM estimation — live query reacts to model/batch/imgsz changes
  const debouncedBatch = useDebounce(Number(batch) || 8, 300);
  const debouncedImgsz = useDebounce(Number(imgsz) || 640, 300);
  const { data: gpuEstimate, isFetching: gpuEstLoading } = useQuery({
    queryKey: ["gpu-estimate", modelArch, debouncedBatch, debouncedImgsz],
    queryFn: () => fetchGpuEstimate(modelArch, debouncedBatch, debouncedImgsz),
    enabled: jobType === "train",
    staleTime: 60_000,
  });

  // Auto-detect latest completed job for "previous" checkpoint
  const completedJobs = useMemo(
    () =>
      (jobs ?? [])
        .filter(
          (j) =>
            j.status === "COMPLETED" &&
            j.job_type === "train" &&
            j.artifact_path,
        )
        .sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() -
            new Date(a.created_at ?? 0).getTime(),
        ),
    [jobs],
  );

  const createMutation = useMutation({
    mutationFn: createJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", projectId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed"),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", projectId] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Failed to cancel"),
  });

  const sortedJobs = useMemo(() => {
    if (!jobs) return [];
    return [...jobs].sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime(),
    );
  }, [jobs]);

  const handleSubmit = () => {
    if (!projectId) return;
    const previousJob =
      checkpoint === "previous" ? completedJobs[0] : undefined;
    const resolvedCheckpoint = previousJob?.artifact_path
      ? previousJob.artifact_path
      : checkpoint;
    const resolvedModelArch =
      checkpoint === "previous" && previousJob?.model_arch
        ? previousJob.model_arch
        : modelArch;
    const resolvedModelPath =
      modelPath === "__custom__" ? customModelPath : modelPath;
    createMutation.mutate({
      project_id: projectId,
      job_type: jobType,
      model_arch: jobType === "train" ? resolvedModelArch : undefined,
      hyperparams:
        jobType === "train"
          ? {
              epochs: Number(epochs),
              batch: Number(batch),
              imgsz: Number(imgsz),
            }
          : undefined,
      model_path:
        jobType === "predict" ? resolvedModelPath || undefined : undefined,
      checkpoint: jobType === "train" ? resolvedCheckpoint : undefined,
      dataset_version_id: selectedVersion || undefined,
    });
  };

  return (
    <ToastProvider>
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Launch training or prediction jobs and monitor progress.
          </p>
        </div>

        {/* ---- Create job form ---- */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">New Job</h2>

          {/* Row 1: Type selector */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Type
              </label>
              <select
                className="rounded border border-border bg-background px-3 py-2 text-sm"
                value={jobType}
                onChange={(e) =>
                  setJobType(e.target.value as "train" | "predict")
                }
              >
                <option value="train">Train</option>
                <option value="predict">Predict (pre-label)</option>
              </select>
            </div>
          </div>

          {/* Train-specific config */}
          {jobType === "train" && (
            <div className="space-y-3">
              {/* Model architecture + size */}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Model Architecture
                  </label>
                  <select
                    className="rounded border border-border bg-background px-3 py-2 text-sm"
                    value={modelArch}
                    onChange={(e) => setModelArch(e.target.value)}
                  >
                    {architectures ? (
                      architectures.map((info) => (
                        <option key={info.key} value={info.key}>
                          {info.name} — {info.size} ({info.params})
                        </option>
                      ))
                    ) : (
                      <option value="yolo11n.pt">YOLO11 Nano</option>
                    )}
                  </select>
                </div>

                {/* Dataset version */}
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Dataset Version (optional)
                  </label>
                  <select
                    className="rounded border border-border bg-background px-3 py-2 text-sm"
                    value={selectedVersion}
                    onChange={(e) => setSelectedVersion(e.target.value)}
                  >
                    <option value="">Latest (live)</option>
                    {(versions ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version_number} — {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Hyperparams row */}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Epochs
                  </label>
                  <Input
                    type="number"
                    value={epochs}
                    onChange={(e) => setEpochs(e.target.value)}
                    className="w-24"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Batch Size
                  </label>
                  <Input
                    type="number"
                    value={batch}
                    onChange={(e) => setBatch(e.target.value)}
                    className="w-24"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Image Size (px)
                  </label>
                  <Input
                    type="number"
                    value={imgsz}
                    onChange={(e) => setImgsz(e.target.value)}
                    className="w-24"
                  />
                </div>
              </div>

              {/* Checkpoint selector */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Checkpoint / Weights
                </label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { value: "coco", label: "Pre-trained (COCO)" },
                    { value: "scratch", label: "Random Init" },
                    ...(completedJobs.length > 0
                      ? [{ value: "previous", label: "Continue from Previous" }]
                      : []),
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        checkpoint === opt.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <input
                        type="radio"
                        name="checkpoint"
                        value={opt.value}
                        checked={checkpoint === opt.value}
                        onChange={() => setCheckpoint(opt.value)}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                {checkpoint === "previous" && completedJobs.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Will use weights from:{" "}
                    <span className="font-mono">
                      {completedJobs[0].artifact_path}
                    </span>
                  </p>
                )}
              </div>

              {/* GPU VRAM Estimation Panel */}
              {gpuEstimate && (
                <GpuEstimatePanel
                  estimate={gpuEstimate}
                  loading={gpuEstLoading}
                />
              )}
            </div>
          )}

          {/* Predict-specific config */}
          {jobType === "predict" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Model
                </label>
                {trainedModels && trainedModels.length > 0 ? (
                  <select
                    className="rounded border border-border bg-background px-3 py-2 text-sm"
                    value={modelPath}
                    onChange={(e) => setModelPath(e.target.value)}
                  >
                    <option value="">Select a trained model…</option>
                    {trainedModels.map((m) => (
                      <option key={m.job_id} value={m.artifact_path}>
                        {m.artifact_path} — {m.model_arch ?? "unknown"}{" "}
                        {m.metrics?.mAP50 != null
                          ? `(mAP50: ${((m.metrics.mAP50 as number) * 100).toFixed(1)}%)`
                          : ""}
                      </option>
                    ))}
                    <option value="__custom__">Custom path…</option>
                  </select>
                ) : (
                  <Input
                    value={modelPath}
                    onChange={(e) => setModelPath(e.target.value)}
                    placeholder="models/best.pt"
                    className="w-64"
                  />
                )}
              </div>
              {modelPath === "__custom__" && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Custom model path (S3 key)
                  </label>
                  <Input
                    value={customModelPath}
                    onChange={(e) => setCustomModelPath(e.target.value)}
                    placeholder="models/best.pt"
                    className="w-64"
                  />
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !projectId}
          >
            {createMutation.isPending ? "Starting…" : "Launch Job"}
          </Button>
        </div>

        <Separator />

        {/* ---- Job list ---- */}
        {isLoading && (
          <div className="text-sm text-muted-foreground">Loading jobs…</div>
        )}
        {sortedJobs.length === 0 && !isLoading && (
          <div className="text-sm text-muted-foreground">
            No jobs yet. Create one above.
          </div>
        )}
        <div className="space-y-3">
          {sortedJobs.map((job) => (
            <div
              key={job.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {statusBadge(job.status)}
                  <span className="text-sm font-medium capitalize">
                    {job.job_type}
                  </span>
                  {job.model_arch && (
                    <span className="text-xs text-muted-foreground">
                      {job.model_arch}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {job.created_at
                      ? new Date(job.created_at).toLocaleString()
                      : "—"}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setExpandedJob(expandedJob === job.id ? null : job.id)
                    }
                  >
                    {expandedJob === job.id ? "Hide Logs" : "Logs"}
                  </Button>
                  {(job.status === "RUNNING" || job.status === "PENDING") && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(job.id)}
                    >
                      {cancelMutation.isPending ? "Stopping…" : "Stop"}
                    </Button>
                  )}
                  {job.status === "COMPLETED" && job.artifact_path && (
                    <span className="text-xs text-green-400">
                      ✓ {job.artifact_path}
                    </span>
                  )}
                  {job.status === "CANCELLED" && (
                    <span className="text-xs text-gray-400">Cancelled</span>
                  )}
                </div>
              </div>
              {expandedJob === job.id && (
                <JobLogViewer
                  jobId={job.id}
                  channel={job.logs_channel}
                  jobStatus={job.status}
                />
              )}
              {/* Progress bar for running/pending train jobs */}
              {(job.status === "RUNNING" || job.status === "PENDING") &&
                job.job_type === "train" && (
                  <JobProgressBar jobId={job.id} jobStatus={job.status} />
                )}
              {/* Metrics panel for completed training jobs */}
              {job.status === "COMPLETED" &&
                job.job_type === "train" &&
                job.metrics &&
                Object.keys(job.metrics).length > 0 && (
                  <div className="mt-3 rounded border border-border bg-muted/40 p-3">
                    <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                      Training Metrics
                    </h4>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                      {[
                        {
                          key: "mAP50",
                          label: "mAP@50",
                          fmt: (v: number) => (v * 100).toFixed(1) + "%",
                        },
                        {
                          key: "mAP50-95",
                          label: "mAP@50-95",
                          fmt: (v: number) => (v * 100).toFixed(1) + "%",
                        },
                        {
                          key: "precision",
                          label: "Precision",
                          fmt: (v: number) => (v * 100).toFixed(1) + "%",
                        },
                        {
                          key: "recall",
                          label: "Recall",
                          fmt: (v: number) => (v * 100).toFixed(1) + "%",
                        },
                        {
                          key: "box_loss",
                          label: "Box Loss",
                          fmt: (v: number) => v.toFixed(4),
                        },
                        {
                          key: "cls_loss",
                          label: "Cls Loss",
                          fmt: (v: number) => v.toFixed(4),
                        },
                      ].map((m) => {
                        const val = job.metrics?.[m.key];
                        if (val === undefined) return null;
                        return (
                          <div key={m.key} className="text-center">
                            <div className="text-lg font-semibold">
                              {m.fmt(val as number)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {m.label}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
            </div>
          ))}
        </div>
      </section>
      <Toast
        open={Boolean(error)}
        onOpenChange={(open: boolean) => !open && setError(null)}
      >
        <ToastTitle>Error</ToastTitle>
        <ToastDescription>{error}</ToastDescription>
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}
