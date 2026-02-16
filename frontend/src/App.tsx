import { Navigate, Route, Routes } from "react-router-dom";

import { DashboardLayout } from "./layouts/DashboardLayout";
import { AdminPage } from "./pages/AdminPage";
import { AnnotationJobsPage } from "./pages/AnnotationJobsPage";
import { DatasetPage } from "./pages/DatasetPage";
import { GalleryPage } from "./pages/GalleryPage";
import { InsightsPage } from "./pages/InsightsPage";
import { JobsPage } from "./pages/JobsPage";
import { LabelReviewPage } from "./pages/LabelReviewPage";
import { LoginPage } from "./pages/LoginPage";
import { ModelsPage } from "./pages/ModelsPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { useAuthStore } from "./store/auth";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <DashboardLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/gallery" replace />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/workspace" element={<WorkspacePage />} />
                <Route path="/workspace/:imageId" element={<WorkspacePage />} />
                <Route path="/dataset" element={<DatasetPage />} />
                <Route path="/jobs" element={<JobsPage />} />
                <Route path="/labels" element={<LabelReviewPage />} />
                <Route path="/annotation-jobs" element={<AnnotationJobsPage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/admin" element={<AdminPage />} />
              </Routes>
            </DashboardLayout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
