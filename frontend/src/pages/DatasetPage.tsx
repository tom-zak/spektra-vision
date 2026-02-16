import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  autoAssignSplits,
  createDatasetVersion,
  deleteDatasetVersion,
  fetchDatasetHealth,
  fetchDatasetVersions,
  fetchProjectTags,
  type DatasetHealth,
  type DatasetVersion,
} from "@/lib/api";
import { useProjectStore } from "@/store/project";

/* ---------- Split pie mini-chart ---------- */

function SplitBar({
  train,
  valid,
  test,
}: {
  train: number;
  valid: number;
  test: number;
}) {
  const total = train + valid + test || 1;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full">
      <div
        className="bg-blue-500"
        style={{ width: `${(train / total) * 100}%` }}
        title={`Train: ${train}`}
      />
      <div
        className="bg-yellow-500"
        style={{ width: `${(valid / total) * 100}%` }}
        title={`Valid: ${valid}`}
      />
      <div
        className="bg-green-500"
        style={{ width: `${(test / total) * 100}%` }}
        title={`Test: ${test}`}
      />
    </div>
  );
}

/* ---------- Health panel ---------- */

function HealthPanel({ health }: { health: DatasetHealth }) {
  const maxClass = Math.max(...Object.values(health.class_balance), 1);
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">Dataset Health</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total Images" value={health.total_images} />
        <Stat label="Annotated" value={health.annotated_images} />
        <Stat label="Unannotated" value={health.unannotated_images} />
        <Stat label="Null (bg)" value={health.null_images} />
        <Stat label="Annotations" value={health.total_annotations} />
        <Stat
          label="Annots / Image"
          value={health.annotations_per_image.toFixed(1)}
        />
      </div>

      {/* Split distribution */}
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">
          Split Distribution
        </div>
        <SplitBar
          train={health.split_counts.TRAIN ?? 0}
          valid={health.split_counts.VALID ?? 0}
          test={health.split_counts.TEST ?? 0}
        />
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            Train {health.split_counts.TRAIN ?? 0}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            Valid {health.split_counts.VALID ?? 0}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            Test {health.split_counts.TEST ?? 0}
          </span>
          {health.split_counts.UNASSIGNED ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-gray-500" />
              Unassigned {health.split_counts.UNASSIGNED}
            </span>
          ) : null}
        </div>
      </div>

      {/* Class balance */}
      {Object.keys(health.class_balance).length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Class Balance
          </div>
          {Object.entries(health.class_balance)
            .sort(([, a], [, b]) => b - a)
            .map(([cls, count]) => (
              <div key={cls} className="flex items-center gap-2">
                <div className="w-24 truncate text-xs">{cls}</div>
                <div className="flex-1">
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${(count / maxClass) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="w-10 text-right text-xs text-muted-foreground">
                  {count}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/* ---------- Version card ---------- */

function VersionCard({
  version,
  onDelete,
}: {
  version: DatasetVersion;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColor: Record<string, string> = {
    GENERATING: "bg-yellow-500/20 text-yellow-400",
    READY: "bg-green-500/20 text-green-400",
    FAILED: "bg-red-500/20 text-red-400",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">
            {version.name || `v${version.version_number}`}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[version.status] ?? ""}`}
          >
            {version.status}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {version.created_at &&
            new Date(version.created_at).toLocaleDateString()}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Less" : "More"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400"
            onClick={() => onDelete(version.id)}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-6 text-sm">
        <span>
          <strong>{version.num_images}</strong> images
        </span>
        <span>
          <strong>{version.num_annotations}</strong> annotations
        </span>
        <span>
          <strong>{version.num_classes}</strong> classes
        </span>
      </div>

      {/* Split bar */}
      <SplitBar
        train={version.num_train}
        valid={version.num_valid}
        test={version.num_test}
      />
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Train: {version.num_train}</span>
        <span>Valid: {version.num_valid}</span>
        <span>Test: {version.num_test}</span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <div>
            <strong>Preprocessing:</strong>{" "}
            {JSON.stringify(version.preprocessing)}
          </div>
          <div>
            <strong>Augmentation:</strong>{" "}
            {JSON.stringify(version.augmentation)}
          </div>
          <div>
            <strong>Split Config:</strong>{" "}
            {(version.train_pct * 100).toFixed(0)}/
            {(version.valid_pct * 100).toFixed(0)}/
            {(version.test_pct * 100).toFixed(0)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Main page ---------- */

export function DatasetPage() {
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.activeProjectId);
  const [error, setError] = useState<string | null>(null);

  // New version form
  const [showCreate, setShowCreate] = useState(false);
  const [versionName, setVersionName] = useState("");
  const [trainPct, setTrainPct] = useState("70");
  const [validPct, setValidPct] = useState("20");
  const [testPct, setTestPct] = useState("10");
  const [resize, setResize] = useState("640");
  const [autoOrient, setAutoOrient] = useState(true);
  const [flipH, setFlipH] = useState(true);
  const [flipV, setFlipV] = useState(false);
  const [rotateDeg, setRotateDeg] = useState("0");
  const [brightnessPct, setBrightnessPct] = useState("0");
  const [mosaic, setMosaic] = useState(false);
  const [outputPerImage, setOutputPerImage] = useState("1");
  const [filterTagId, setFilterTagId] = useState<string | null>(null);

  const { data: versions, isLoading: loadingVersions } = useQuery({
    queryKey: ["versions", projectId],
    queryFn: () => fetchDatasetVersions(projectId!),
    enabled: Boolean(projectId),
  });

  const { data: projectTags = [] } = useQuery({
    queryKey: ["projectTags", projectId],
    queryFn: () => fetchProjectTags(projectId!),
    enabled: Boolean(projectId),
  });

  const { data: health } = useQuery({
    queryKey: ["health", projectId],
    queryFn: () => fetchDatasetHealth(projectId!),
    enabled: Boolean(projectId),
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createDatasetVersion>[1]) =>
      createDatasetVersion(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["versions", projectId] });
      queryClient.invalidateQueries({ queryKey: ["health", projectId] });
      setShowCreate(false);
      setVersionName("");
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Failed to create version"),
  });

  const deleteMutation = useMutation({
    mutationFn: (versionId: string) =>
      deleteDatasetVersion(projectId!, versionId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["versions", projectId] }),
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Failed to delete"),
  });

  const splitMutation = useMutation({
    mutationFn: (data: {
      train_pct: number;
      valid_pct: number;
      test_pct: number;
    }) => autoAssignSplits(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health", projectId] });
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Failed to assign splits"),
  });

  const handleCreateVersion = () => {
    const tp = Number(trainPct) / 100;
    const vp = Number(validPct) / 100;
    const ep = Number(testPct) / 100;
    createMutation.mutate({
      name: versionName || undefined,
      train_pct: tp,
      valid_pct: vp,
      test_pct: ep,
      filter_tag_id: filterTagId ?? undefined,
      preprocessing: {
        resize: Number(resize) || 640,
        auto_orient: autoOrient,
        grayscale: false,
        contrast: null,
        tile: null,
      },
      augmentation: {
        flip_horizontal: flipH,
        flip_vertical: flipV,
        rotate_degrees: Number(rotateDeg) || 0,
        brightness_pct: Number(brightnessPct) / 100 || 0,
        blur_px: 0,
        noise_pct: 0,
        cutout_pct: 0,
        mosaic,
        mixup: 0,
        output_per_image: Number(outputPerImage) || 1,
      },
    });
  };

  return (
    <ToastProvider>
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Dataset Management</h1>
          <p className="text-sm text-muted-foreground">
            Create frozen dataset versions with train/valid/test splits,
            preprocessing, and augmentation configuration.
          </p>
        </div>

        {/* ---- Health panel ---- */}
        {health && <HealthPanel health={health} />}

        {/* ---- Auto-assign splits ---- */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">
            Auto-Assign Train / Valid / Test Splits
          </h2>
          <p className="text-xs text-muted-foreground">
            Randomly assign all images to train, validation, and test sets.
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Train %
              </label>
              <Input
                type="number"
                value={trainPct}
                onChange={(e) => setTrainPct(e.target.value)}
                className="w-20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Valid %
              </label>
              <Input
                type="number"
                value={validPct}
                onChange={(e) => setValidPct(e.target.value)}
                className="w-20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Test %
              </label>
              <Input
                type="number"
                value={testPct}
                onChange={(e) => setTestPct(e.target.value)}
                className="w-20"
              />
            </div>
            <Button
              onClick={() =>
                splitMutation.mutate({
                  train_pct: Number(trainPct) / 100,
                  valid_pct: Number(validPct) / 100,
                  test_pct: Number(testPct) / 100,
                })
              }
              disabled={splitMutation.isPending}
            >
              {splitMutation.isPending ? "Assigning…" : "Rebalance Splits"}
            </Button>
          </div>
        </div>

        <Separator />

        {/* ---- Version list ---- */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Versions</h2>
          <Button onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? "Cancel" : "Generate New Version"}
          </Button>
        </div>

        {/* ---- Create version form ---- */}
        {showCreate && (
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold">Step 1: Configuration</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Version Name
                </label>
                <Input
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  placeholder="e.g. v1-baseline"
                  className="w-40"
                />
              </div>
              {projectTags.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Filter by Tag (optional)
                  </label>
                  <select
                    value={filterTagId ?? ""}
                    onChange={(e) =>
                      setFilterTagId(e.target.value || null)
                    }
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  >
                    <option value="">All images</option>
                    {projectTags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <h3 className="text-sm font-semibold">
              Step 2: Train / Test Split
            </h3>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Train %
                </label>
                <Input
                  type="number"
                  value={trainPct}
                  onChange={(e) => setTrainPct(e.target.value)}
                  className="w-20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Valid %
                </label>
                <Input
                  type="number"
                  value={validPct}
                  onChange={(e) => setValidPct(e.target.value)}
                  className="w-20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Test %
                </label>
                <Input
                  type="number"
                  value={testPct}
                  onChange={(e) => setTestPct(e.target.value)}
                  className="w-20"
                />
              </div>
            </div>

            <h3 className="text-sm font-semibold">Step 3: Preprocessing</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Resize (px)
                </label>
                <Input
                  type="number"
                  value={resize}
                  onChange={(e) => setResize(e.target.value)}
                  className="w-24"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoOrient}
                  onChange={(e) => setAutoOrient(e.target.checked)}
                />
                Auto-Orient
              </label>
            </div>

            <h3 className="text-sm font-semibold">Step 4: Augmentation</h3>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={flipH}
                  onChange={(e) => setFlipH(e.target.checked)}
                />
                Flip Horizontal
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={flipV}
                  onChange={(e) => setFlipV(e.target.checked)}
                />
                Flip Vertical
              </label>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Rotation (deg)
                </label>
                <Input
                  type="number"
                  value={rotateDeg}
                  onChange={(e) => setRotateDeg(e.target.value)}
                  className="w-20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Brightness %
                </label>
                <Input
                  type="number"
                  value={brightnessPct}
                  onChange={(e) => setBrightnessPct(e.target.value)}
                  className="w-20"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mosaic}
                  onChange={(e) => setMosaic(e.target.checked)}
                />
                Mosaic
              </label>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Output / Image
                </label>
                <Input
                  type="number"
                  value={outputPerImage}
                  onChange={(e) => setOutputPerImage(e.target.value)}
                  className="w-20"
                  min={1}
                  max={10}
                />
              </div>
            </div>

            <Button
              onClick={handleCreateVersion}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Generating…" : "Generate"}
            </Button>
          </div>
        )}

        {/* ---- Existing versions ---- */}
        {loadingVersions && (
          <div className="text-sm text-muted-foreground">Loading versions…</div>
        )}
        {versions && versions.length === 0 && !loadingVersions && (
          <div className="text-sm text-muted-foreground">
            No dataset versions yet. Generate your first version above.
          </div>
        )}
        <div className="space-y-3">
          {versions?.map((v) => (
            <VersionCard
              key={v.id}
              version={v}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
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
