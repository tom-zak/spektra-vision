import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  Plus,
  Pencil,
  Users,
  FolderKanban,
  ShieldCheck,
  ShieldAlert,
  Shield,
} from "lucide-react";

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
import { LabelSettings } from "@/components/admin/LabelSettings";
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  fetchUsers,
  updateUser,
  deleteUser,
  apiRegister,
  type Project,
  type AuthUser,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const ROLE_META: Record<
  string,
  { icon: typeof Shield; color: string; label: string }
> = {
  ADMIN: { icon: ShieldCheck, color: "text-amber-400", label: "Admin" },
  ANNOTATOR: { icon: Shield, color: "text-blue-400", label: "Annotator" },
  REVIEWER: { icon: ShieldAlert, color: "text-emerald-400", label: "Reviewer" },
};

export function AdminPage() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [toast, setToast] = useState<{
    title: string;
    description?: string;
  } | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // ---- Projects ----
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectType, setNewProjectType] = useState<
    "DETECTION" | "SEGMENTATION" | "CLASSIFICATION"
  >("DETECTION");
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState("");

  const createProjectMut = useMutation({
    mutationFn: () =>
      createProject({ name: newProjectName.trim(), task_type: newProjectType }),
    onSuccess: () => {
      setNewProjectName("");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const updateProjectMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateProject(id, { name }),
    onSuccess: () => {
      setEditingProject(null);
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const deleteProjectMut = useMutation({
    mutationFn: deleteProject,
    onMutate: async (projectId) => {
      await qc.cancelQueries({ queryKey: ["projects"] });
      const previousProjects = qc.getQueryData<Project[]>(["projects"]);
      if (previousProjects) {
        qc.setQueryData<Project[]>(
          ["projects"],
          previousProjects.filter((project) => project.id !== projectId),
        );
      }
      return { previousProjects };
    },
    onSuccess: () => {
      setToast({ title: "Project deleted", description: "Project removed." });
    },
    onError: (err, _vars, context) => {
      if (context?.previousProjects) {
        qc.setQueryData<Project[]>(["projects"], context.previousProjects);
      }
      setToast({
        title: "Delete failed",
        description:
          err instanceof Error ? err.message : "Unable to delete project",
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  // ---- Users ----
  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });

  const [showAddUser, setShowAddUser] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("ANNOTATOR");

  const addUserMut = useMutation({
    mutationFn: () => apiRegister(newEmail.trim(), newPassword, newRole),
    onSuccess: (createdUser) => {
      setNewEmail("");
      setNewPassword("");
      setShowAddUser(false);
      setToast({ title: "User added", description: "Team member created." });
      qc.setQueryData<AuthUser[]>(["users"], (prev = []) => [
        ...prev,
        createdUser,
      ]);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) =>
      setToast({
        title: "Add failed",
        description: err instanceof Error ? err.message : "Unable to add user",
      }),
  });

  const updateUserMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      updateUser(id, { role }),
    onMutate: async ({ id, role }) => {
      setPendingUserId(id);
      await qc.cancelQueries({ queryKey: ["users"] });
      const previousUsers = qc.getQueryData<AuthUser[]>(["users"]);
      if (previousUsers) {
        qc.setQueryData<AuthUser[]>(
          ["users"],
          previousUsers.map((user) =>
            user.id === id ? { ...user, role } : user,
          ),
        );
      }
      return { previousUsers };
    },
    onSuccess: (updatedUser) => {
      setToast({ title: "Role updated", description: "User role saved." });
      qc.setQueryData<AuthUser[]>(["users"], (prev = []) =>
        prev.map((user) => (user.id === updatedUser.id ? updatedUser : user)),
      );
    },
    onError: (err, _vars, context) => {
      if (context?.previousUsers) {
        qc.setQueryData<AuthUser[]>(["users"], context.previousUsers);
      }
      setToast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unable to update",
      });
    },
    onSettled: () => {
      setPendingUserId(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const deleteUserMut = useMutation({
    mutationFn: deleteUser,
    onMutate: async (userId) => {
      setPendingUserId(userId);
      await qc.cancelQueries({ queryKey: ["users"] });
      const previousUsers = qc.getQueryData<AuthUser[]>(["users"]);
      if (previousUsers) {
        qc.setQueryData<AuthUser[]>(
          ["users"],
          previousUsers.filter((user) => user.id !== userId),
        );
      }
      return { previousUsers };
    },
    onSuccess: () => {
      setToast({ title: "User removed", description: "Team member deleted." });
    },
    onError: (err, _vars, context) => {
      if (context?.previousUsers) {
        qc.setQueryData<AuthUser[]>(["users"], context.previousUsers);
      }
      setToast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unable to delete",
      });
    },
    onSettled: () => {
      setPendingUserId(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  return (
    <ToastProvider>
      <section className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage projects and team members.
          </p>
        </div>

        {/* ---- Projects ---- */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold">Projects</h2>
          </div>

          <div className="space-y-2">
            {projects.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3"
              >
                {editingProject === p.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editProjectName}
                      onChange={(e) => setEditProjectName(e.target.value)}
                      className="h-8 max-w-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editProjectName.trim()) {
                          updateProjectMut.mutate({
                            id: p.id,
                            name: editProjectName.trim(),
                          });
                        }
                        if (e.key === "Escape") setEditingProject(null);
                      }}
                    />
                    <Button
                      size="sm"
                      disabled={
                        !editProjectName.trim() || updateProjectMut.isPending
                      }
                      onClick={() =>
                        updateProjectMut.mutate({
                          id: p.id,
                          name: editProjectName.trim(),
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingProject(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-3 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {p.task_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingProject(p.id);
                          setEditProjectName(p.name);
                        }}
                        title="Rename"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        disabled={deleteProjectMut.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete project "${p.name}"? This cannot be undone.`,
                            )
                          )
                            deleteProjectMut.mutate(p.id);
                        }}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Project name
              </label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="My Project"
                className="h-9 w-56"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newProjectName.trim())
                    createProjectMut.mutate();
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Task type
              </label>
              <select
                className="h-9 rounded border border-border bg-background px-3 text-sm"
                value={newProjectType}
                onChange={(e) =>
                  setNewProjectType(e.target.value as typeof newProjectType)
                }
              >
                <option value="DETECTION">Detection</option>
                <option value="SEGMENTATION">Segmentation</option>
                <option value="CLASSIFICATION">Classification</option>
              </select>
            </div>
            <Button
              className="gap-1"
              disabled={!newProjectName.trim() || createProjectMut.isPending}
              onClick={() => createProjectMut.mutate()}
            >
              <Plus className="h-4 w-4" /> Create
            </Button>
          </div>
        </div>

        {/* ---- Labels ---- */}
        <LabelSettings />

        {/* ---- Users ---- */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-base font-semibold">Team Members</h2>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1"
              onClick={() => setShowAddUser(!showAddUser)}
            >
              <Plus className="h-4 w-4" /> Add User
            </Button>
          </div>

          {showAddUser && (
            <div className="flex items-end gap-3 rounded-md border border-border bg-muted/20 p-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Email
                </label>
                <Input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="h-9 w-56"
                  disabled={addUserMut.isPending}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Password
                </label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••"
                  className="h-9 w-40"
                  disabled={addUserMut.isPending}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Role
                </label>
                <select
                  className="h-9 rounded border border-border bg-background px-3 text-sm"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  disabled={addUserMut.isPending}
                >
                  <option value="ANNOTATOR">Annotator</option>
                  <option value="REVIEWER">Reviewer</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <Button
                size="sm"
                disabled={
                  !newEmail.trim() ||
                  !newPassword ||
                  newPassword.length < 6 ||
                  addUserMut.isPending
                }
                onClick={() => addUserMut.mutate()}
              >
                {addUserMut.isPending ? "Adding…" : "Add"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddUser(false)}
              >
                Cancel
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {users.map((u) => {
              const roleMeta = ROLE_META[u.role] ?? ROLE_META.ANNOTATOR;
              const RoleIcon = roleMeta.icon;
              const isSelf = u.id === currentUser?.id;
              const isUserPending = pendingUserId === u.id;
              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <RoleIcon className={`h-4 w-4 ${roleMeta.color}`} />
                    <span className="font-medium">{u.email}</span>
                    {isSelf && (
                      <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
                        you
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      className="h-8 rounded border border-border bg-background px-2 text-sm"
                      value={u.role}
                      disabled={isSelf || isUserPending}
                      onChange={(e) =>
                        updateUserMut.mutate({ id: u.id, role: e.target.value })
                      }
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="ANNOTATOR">Annotator</option>
                      <option value="REVIEWER">Reviewer</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      disabled={isSelf || isUserPending}
                      onClick={() => {
                        if (confirm(`Remove user "${u.email}"?`))
                          deleteUserMut.mutate(u.id);
                      }}
                      title={isSelf ? "Cannot delete yourself" : "Delete user"}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <Toast
        open={Boolean(toast)}
        onOpenChange={(open) => !open && setToast(null)}
      >
        <ToastTitle>{toast?.title}</ToastTitle>
        {toast?.description && (
          <ToastDescription>{toast.description}</ToastDescription>
        )}
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}
