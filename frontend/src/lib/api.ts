export type Project = {
  id: string;
  name: string;
  task_type: "CLASSIFICATION" | "DETECTION" | "SEGMENTATION";
  ontology: Record<string, unknown>;
};

export type LabelSummary = {
  id: string;
  name: string;
  color: string | null;
  count: number;
  ai_count: number;
};

export type ImageItem = {
  id: string;
  status: "NEW" | "IN_PROGRESS" | "DONE";
  storage_path: string;
  width: number | null;
  height: number | null;
  url: string;
  meta: Record<string, unknown>;
  split?: "UNASSIGNED" | "TRAIN" | "VALID" | "TEST";
  is_null?: boolean;
  review_status?: "UNREVIEWED" | "APPROVED" | "REJECTED" | "NEEDS_REVISION";
  reviewed_by?: string | null;
  review_comment?: string | null;
  tags?: Tag[];
  annotation_count?: number;
  prediction_count?: number;
  labels?: LabelSummary[];
};

export type ImageListResponse = {
  items: ImageItem[];
  next_after_created_at: string | null;
  next_after_id: string | null;
};

export type Label = {
  id: string;
  name: string;
  path: string;
  color: string | null;
};

export type Annotation = {
  id: string;
  label_id: string;
  geometry: Record<string, unknown>;
  confidence: number | null;
  is_prediction: boolean;
};

export type Job = {
  id: string;
  project_id: string;
  job_type: "train" | "predict";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  logs_channel: string;
  model_arch: string | null;
  hyperparams: Record<string, unknown>;
  artifact_path: string | null;
  created_at: string | null;
  dataset_version_id: string | null;
  metrics: Record<string, unknown>;
  checkpoint: string | null;
};

export type ModelArchInfo = {
  key: string;
  name: string;
  size: string;
  params: string;
};

export type DatasetVersion = {
  id: string;
  project_id: string;
  version_number: number;
  name: string | null;
  status: "GENERATING" | "READY" | "FAILED";
  train_pct: number;
  valid_pct: number;
  test_pct: number;
  preprocessing: Record<string, unknown>;
  augmentation: Record<string, unknown>;
  num_images: number;
  num_train: number;
  num_valid: number;
  num_test: number;
  num_annotations: number;
  num_classes: number;
  created_at: string | null;
};

export type DatasetHealth = {
  total_images: number;
  annotated_images: number;
  unannotated_images: number;
  null_images: number;
  total_annotations: number;
  annotations_per_image: number;
  class_balance: Record<string, number>;
  split_counts: Record<string, number>;
  images_by_status: Record<string, number>;
};

export type TrainedModel = {
  job_id: string;
  project_id: string;
  artifact_path: string;
  model_arch: string | null;
  metrics: Record<string, unknown>;
  created_at: string | null;
  dataset_version_id: string | null;
  display_name: string | null;
  notes: string | null;
};

export type Tag = {
  id: string;
  name: string;
  color: string | null;
  project_id: string;
};

const baseUrl = import.meta.env.VITE_API_URL ?? "/api";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("spektra_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = getAuthHeaders();
  const headers = {
    ...auth,
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (response.status === 401) {
    // Token expired or invalid — clear auth
    localStorage.removeItem("spektra_token");
    localStorage.removeItem("spektra_user");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Request failed");
  }
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const bodyText = await response.text();
  if (!bodyText) {
    return undefined as T;
  }
  if (contentType.includes("application/json")) {
    return JSON.parse(bodyText) as T;
  }
  return bodyText as unknown as T;
}

// ---- Projects ----

export async function fetchProjects(): Promise<Project[]> {
  return apiFetch<Project[]>("/projects");
}

export async function fetchProject(projectId: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}`);
}

export async function createProject(data: {
  name: string;
  task_type: string;
  ontology?: Record<string, unknown>;
}): Promise<Project> {
  return apiFetch<Project>("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateProject(
  projectId: string,
  data: { name?: string; task_type?: string },
): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}`, { method: "DELETE" });
}

export async function fetchProjectStats(projectId: string): Promise<{
  total_images: number;
  images_by_status: Record<string, number>;
  total_annotations: number;
}> {
  return apiFetch(`/projects/${projectId}/stats`);
}

// ---- Images ----

export async function fetchImages(
  projectId: string,
  params?: {
    status?: "NEW" | "IN_PROGRESS" | "DONE";
    review_status?: "UNREVIEWED" | "APPROVED" | "REJECTED" | "NEEDS_REVISION";
    after_created_at?: string | null;
    after_id?: string | null;
    tag?: string | null;
    tag_id?: string | null;
    label_id?: string | null;
    annotation_source?: string | null;
    limit?: number;
  },
): Promise<ImageListResponse> {
  const query = new URLSearchParams();
  if (params?.status) {
    query.set("status", params.status);
  }
  if (params?.review_status) {
    query.set("review_status", params.review_status);
  }
  if (params?.after_created_at) {
    query.set("after_created_at", params.after_created_at);
  }
  if (params?.after_id) {
    query.set("after_id", params.after_id);
  }
  if (params?.tag_id) {
    query.set("tag_id", params.tag_id);
  } else if (params?.tag) {
    query.set("tag", params.tag);
  }
  if (params?.label_id) {
    query.set("label_id", params.label_id);
  }
  if (params?.annotation_source) {
    query.set("annotation_source", params.annotation_source);
  }
  if (params?.limit) {
    query.set("limit", String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<ImageListResponse>(`/projects/${projectId}/images${suffix}`);
}

export async function uploadImages(
  projectId: string,
  files: File[],
): Promise<void> {
  const formData = new FormData();
  formData.append("project_id", projectId);
  for (const file of files) {
    formData.append("files", file);
  }
  await apiFetch("/images/upload", {
    method: "POST",
    body: formData,
  });
}

export type ImportResult = {
  imported_images: number;
  imported_annotations: number;
  labels: number;
  splits: string[];
};

export async function importYolov4Dataset(
  projectId: string,
  zipFile: File,
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append("file", zipFile);
  return apiFetch<ImportResult>(
    `/projects/${projectId}/import/yolov4-pytorch`,
    {
      method: "POST",
      body: formData,
    },
  );
}

export async function updateImageStatus(
  imageId: string,
  status: "NEW" | "IN_PROGRESS" | "DONE",
): Promise<void> {
  await apiFetch(`/images/${imageId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function deleteImage(imageId: string): Promise<void> {
  await apiFetch(`/images/${imageId}`, { method: "DELETE" });
}

// ---- Labels ----

export async function fetchLabels(projectId: string): Promise<Label[]> {
  return apiFetch<Label[]>(`/projects/${projectId}/labels`);
}

export async function createLabel(
  projectId: string,
  data: { name: string; path: string; color?: string },
): Promise<Label> {
  return apiFetch<Label>(`/projects/${projectId}/labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateLabel(
  projectId: string,
  labelId: string,
  data: { name?: string; color?: string },
): Promise<Label> {
  return apiFetch<Label>(`/projects/${projectId}/labels/${labelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteLabel(
  projectId: string,
  labelId: string,
): Promise<void> {
  await apiFetch(`/projects/${projectId}/labels/${labelId}`, {
    method: "DELETE",
  });
}

// ---- Annotations ----

export async function fetchAnnotations(imageId: string): Promise<Annotation[]> {
  return apiFetch<Annotation[]>(`/images/${imageId}/annotations`);
}

export async function updateAnnotations(
  imageId: string,
  ops: Array<{
    action: "create" | "update" | "delete";
    id?: string;
    label_id?: string;
    geometry?: Record<string, unknown>;
    confidence?: number | null;
    is_prediction?: boolean;
  }>,
): Promise<Annotation[]> {
  const data = await apiFetch<{ annotations: Annotation[] }>(
    `/images/${imageId}/annotations`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    },
  );
  return data.annotations;
}

// ---- Jobs ----

export async function fetchJobs(projectId?: string): Promise<Job[]> {
  const query = projectId ? `?project_id=${projectId}` : "";
  return apiFetch<Job[]>(`/jobs${query}`);
}

export async function fetchJob(jobId: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${jobId}`);
}

export async function createJob(data: {
  project_id: string;
  job_type: "train" | "predict";
  model_arch?: string;
  hyperparams?: Record<string, unknown>;
  model_path?: string;
  checkpoint?: string;
  dataset_version_id?: string;
}): Promise<Job> {
  return apiFetch<Job>("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function cancelJob(jobId: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${jobId}/cancel`, { method: "POST" });
}

export type JobLogEntry = { ts: string; line: string };

export async function fetchJobLogs(jobId: string): Promise<JobLogEntry[]> {
  return apiFetch<JobLogEntry[]>(`/jobs/${jobId}/logs`);
}

// ---- Job Progress ----

export type JobProgress = {
  epoch: number;
  total_epochs: number;
  batch: number;
  total_batches: number;
  pct: number;
  elapsed_secs: number;
  eta_secs: number;
  phase: string;
};

export async function fetchJobProgress(jobId: string): Promise<JobProgress> {
  return apiFetch<JobProgress>(`/jobs/${jobId}/progress`);
}

// ---- Model Architectures ----

export async function fetchModelArchitectures(): Promise<ModelArchInfo[]> {
  return apiFetch<ModelArchInfo[]>("/jobs/model-architectures");
}

// ---- GPU Estimation ----

export type GpuEstimate = {
  model_params_mb: number;
  optimizer_mb: number;
  activation_mb: number;
  cuda_overhead_mb: number;
  total_mb: number;
  total_gb: number;
  fits_gpus: string[];
  tight_gpus: string[];
  too_small_gpus: string[];
  suggested_max_batch_16gb: number;
};

export async function fetchGpuEstimate(
  modelArch: string,
  batch: number,
  imgsz: number,
): Promise<GpuEstimate> {
  return apiFetch<GpuEstimate>(
    `/jobs/estimate-gpu?model_arch=${encodeURIComponent(modelArch)}&batch=${batch}&imgsz=${imgsz}`,
  );
}

// ---- Auto-Annotate (Label Assist) ----

export async function autoAnnotate(
  projectId: string,
  modelPath: string,
  limit: number = 50,
): Promise<Job> {
  return apiFetch<Job>(
    `/jobs/auto-annotate?project_id=${projectId}&model_path=${encodeURIComponent(modelPath)}&limit=${limit}`,
    { method: "POST" },
  );
}

export async function predictSingleImage(
  projectId: string,
  imageId: string,
  modelPath: string = "latest",
): Promise<Job> {
  return apiFetch<Job>(
    `/jobs/predict-image?project_id=${projectId}&image_id=${imageId}&model_path=${encodeURIComponent(modelPath)}`,
    { method: "POST" },
  );
}

export type LabelComparisonData = {
  per_class: {
    label_id: string;
    label_name: string;
    label_color: string | null;
    total: number;
    ai_count: number;
    manual_count: number;
    image_count: number;
  }[];
  per_image: {
    image_id: string;
    filename: string;
    url: string;
    ai_count: number;
    manual_count: number;
  }[];
  summary: {
    total_ai: number;
    total_manual: number;
    images_with_both: number;
    images_ai_only: number;
    images_manual_only: number;
    images_neither: number;
  };
};

export async function fetchLabelComparison(
  projectId: string,
): Promise<LabelComparisonData> {
  return apiFetch<LabelComparisonData>(
    `/projects/${projectId}/label-comparison`,
  );
}

// ---- Dataset Versions ----

export async function fetchDatasetVersions(
  projectId: string,
): Promise<DatasetVersion[]> {
  return apiFetch<DatasetVersion[]>(`/projects/${projectId}/versions`);
}

export async function createDatasetVersion(
  projectId: string,
  data: {
    name?: string;
    train_pct?: number;
    valid_pct?: number;
    test_pct?: number;
    preprocessing?: Record<string, unknown>;
    augmentation?: Record<string, unknown>;
    filter_tag_id?: string;
  },
): Promise<DatasetVersion> {
  return apiFetch<DatasetVersion>(`/projects/${projectId}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteDatasetVersion(
  projectId: string,
  versionId: string,
): Promise<void> {
  await apiFetch(`/projects/${projectId}/versions/${versionId}`, {
    method: "DELETE",
  });
}

export async function autoAssignSplits(
  projectId: string,
  data: { train_pct: number; valid_pct: number; test_pct: number },
): Promise<{ assigned: number; splits: Record<string, number> }> {
  return apiFetch(`/projects/${projectId}/splits/auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function fetchDatasetHealth(
  projectId: string,
): Promise<DatasetHealth> {
  return apiFetch<DatasetHealth>(`/projects/${projectId}/health`);
}

// ---- Image Null / Split ----

export async function markImageNull(
  imageId: string,
  isNull: boolean,
): Promise<void> {
  await apiFetch(`/images/${imageId}/null`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_null: isNull }),
  });
}

export async function updateImageSplit(
  imageId: string,
  split: "UNASSIGNED" | "TRAIN" | "VALID" | "TEST",
): Promise<void> {
  await apiFetch(`/images/${imageId}/split`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ split }),
  });
}

// ---- Trained Models Registry ----

export async function fetchTrainedModels(
  projectId: string,
): Promise<TrainedModel[]> {
  return apiFetch<TrainedModel[]>(`/models/projects/${projectId}`);
}

// ---- Tags ----

export async function fetchProjectTags(projectId: string): Promise<Tag[]> {
  return apiFetch<Tag[]>(`/tags/projects/${projectId}`);
}

export async function createTag(
  projectId: string,
  data: { name: string; color?: string },
): Promise<Tag> {
  return apiFetch<Tag>(`/tags/projects/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteTag(tagId: string): Promise<void> {
  await apiFetch(`/tags/${tagId}`, { method: "DELETE" });
}

export async function updateImageTags(
  imageId: string,
  tagIds: string[],
): Promise<{ image_id: string; tags: Tag[] }> {
  return apiFetch(`/images/${imageId}/tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_ids: tagIds }),
  });
}

export async function bulkUpdateTags(
  imageIds: string[],
  addTagIds: string[],
  removeTagIds: string[] = [],
): Promise<{ updated: number }> {
  return apiFetch(`/images/bulk-tags`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_ids: imageIds,
      add_tag_ids: addTagIds,
      remove_tag_ids: removeTagIds,
    }),
  });
}

// ---- Auth ----

export type AuthUser = { id: string; email: string; role: string };

export async function apiLogin(
  email: string,
  password: string,
): Promise<{ access_token: string; token_type: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Login failed");
  }
  return res.json();
}

export async function apiRegister(
  email: string,
  password: string,
  role?: string,
): Promise<AuthUser> {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, role: role ?? "ANNOTATOR" }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Registration failed");
  }
  return res.json();
}

export async function apiMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>("/auth/me");
}

// ---- User Management (admin) ----

export async function fetchUsers(): Promise<AuthUser[]> {
  return apiFetch<AuthUser[]>("/auth/users");
}

export async function updateUser(
  userId: string,
  data: { role?: string; email?: string },
): Promise<AuthUser> {
  return apiFetch<AuthUser>(`/auth/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await apiFetch(`/auth/users/${userId}`, { method: "DELETE" });
}

// ---- Annotation Jobs ----

export type AnnotationJob = {
  id: string;
  project_id: string;
  assigned_to: string | null;
  assignee_email: string | null;
  batch_name: string | null;
  instructions: string | null;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "REVIEW";
  image_ids: Record<string, string>;
  total_images: number;
  completed_images: number;
  created_at: string | null;
  created_by: string | null;
};

export async function fetchAnnotationJobs(
  projectId?: string,
): Promise<AnnotationJob[]> {
  const query = projectId ? `?project_id=${projectId}` : "";
  return apiFetch<AnnotationJob[]>(`/annotation-jobs${query}`);
}

export async function fetchAnnotationJob(
  jobId: string,
): Promise<AnnotationJob> {
  return apiFetch<AnnotationJob>(`/annotation-jobs/${jobId}`);
}

export async function createAnnotationJob(data: {
  project_id: string;
  assigned_to?: string | null;
  batch_name?: string | null;
  instructions?: string | null;
  image_ids?: string[];
  image_count?: number;
}): Promise<AnnotationJob> {
  return apiFetch<AnnotationJob>("/annotation-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateAnnotationJob(
  jobId: string,
  data: {
    status?: string;
    assigned_to?: string | null;
    batch_name?: string | null;
    instructions?: string | null;
  },
): Promise<AnnotationJob> {
  return apiFetch<AnnotationJob>(`/annotation-jobs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateAnnotationJobImage(
  jobId: string,
  imageId: string,
  status: "pending" | "in_progress" | "done" | "review",
): Promise<AnnotationJob> {
  return apiFetch<AnnotationJob>(
    `/annotation-jobs/${jobId}/images/${imageId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
}

export async function deleteAnnotationJob(jobId: string): Promise<void> {
  await apiFetch(`/annotation-jobs/${jobId}`, { method: "DELETE" });
}

// ---- Insights ----

export type DailyStat = { date: string; count: number };

export type UserStat = {
  user_id: string;
  email: string | null;
  annotations_created: number;
  annotations_updated: number;
  annotations_deleted: number;
  total_actions: number;
};

export type InsightsData = {
  annotations_per_day: DailyStat[];
  images_completed_per_day: DailyStat[];
  user_stats: UserStat[];
  total_reviewed: number;
  total_approved: number;
  total_rejected: number;
  rejection_rate: number;
};

export async function fetchProjectInsights(
  projectId: string,
  days: number = 30,
): Promise<InsightsData> {
  return apiFetch<InsightsData>(`/insights/projects/${projectId}?days=${days}`);
}

// ---- Image Review ----

export async function reviewImage(
  imageId: string,
  reviewStatus: string,
  comment?: string | null,
): Promise<{
  image_id: string;
  review_status: string;
  reviewed_by: string | null;
  review_comment: string | null;
}> {
  return apiFetch(`/images/${imageId}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_status: reviewStatus, comment }),
  });
}

// ---- Model Management ----

export async function updateModel(
  projectId: string,
  jobId: string,
  data: { display_name?: string; notes?: string },
): Promise<TrainedModel> {
  return apiFetch<TrainedModel>(`/models/projects/${projectId}/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteModel(
  projectId: string,
  jobId: string,
): Promise<void> {
  await apiFetch(`/models/projects/${projectId}/${jobId}`, {
    method: "DELETE",
  });
}
