import { useQuery } from "@tanstack/react-query";

import { fetchLabelComparison, type LabelComparisonData } from "@/lib/api";
import { useProjectStore } from "@/store/project";

export function LabelReviewPage() {
  const projectId = useProjectStore((s) => s.activeProjectId);

  const { data, isLoading } = useQuery<LabelComparisonData>({
    queryKey: ["label-comparison", projectId],
    queryFn: () => fetchLabelComparison(projectId!),
    enabled: Boolean(projectId),
  });

  if (!projectId) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        Select a project first.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground py-8">
        Loading comparison data…
      </div>
    );
  }

  if (!data) return null;

  const { per_class, summary, per_image } = data;

  return (
    <section className="flex flex-col gap-6 overflow-y-auto">
      <div>
        <h1 className="text-2xl font-semibold">Label Review</h1>
        <p className="text-sm text-muted-foreground">
          Compare AI predictions against manual annotations.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Manual annotations" value={summary.total_manual} />
        <Card label="AI predictions" value={summary.total_ai} />
        <Card label="Images with both" value={summary.images_with_both} />
        <Card label="Unannotated images" value={summary.images_neither} />
      </div>

      {/* Per-class table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Per-class breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2 text-right">Manual</th>
                <th className="px-4 py-2 text-right">AI</th>
                <th className="px-4 py-2 text-right">Total images</th>
              </tr>
            </thead>
            <tbody>
              {per_class.map((row) => (
                <tr
                  key={row.label_id}
                  className="border-b border-border last:border-0"
                >
                  <td className="flex items-center gap-2 px-4 py-2 font-medium">
                    <span
                      className="inline-block h-3 w-3 rounded"
                      style={{ backgroundColor: row.label_color ?? "#6b7280" }}
                    />
                    {row.label_name}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.manual_count}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-purple-400">
                    {row.ai_count}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.image_count}
                  </td>
                </tr>
              ))}
              {per_class.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    No annotations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-image table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            Per-image comparison{" "}
            <span className="font-normal text-muted-foreground">
              (first 200)
            </span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Image</th>
                <th className="px-4 py-2 text-right">Manual</th>
                <th className="px-4 py-2 text-right">AI</th>
              </tr>
            </thead>
            <tbody>
              {per_image.map((row) => (
                <tr
                  key={row.image_id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2 truncate max-w-xs">
                    {row.filename}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.manual_count}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-purple-400">
                    {row.ai_count}
                  </td>
                </tr>
              ))}
              {per_image.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    No images with annotations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
