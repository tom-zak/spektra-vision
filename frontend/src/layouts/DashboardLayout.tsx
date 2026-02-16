import { PropsWithChildren } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Box,
  ClipboardList,
  Database,
  GalleryHorizontal,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Tags,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { fetchProjects } from "@/lib/api";
import { useProjectStore } from "@/store/project";
import { useAuthStore } from "@/store/auth";
import spektraLogo from "@/assets/spektra.svg";

const navItems = [
  { to: "/gallery", label: "Gallery", icon: GalleryHorizontal },
  { to: "/workspace", label: "Workspace", icon: LayoutDashboard },
  { to: "/dataset", label: "Dataset", icon: Database },
  { to: "/jobs", label: "Jobs", icon: Sparkles },
  { to: "/labels", label: "Label QA", icon: Tags },
  { to: "/annotation-jobs", label: "Labeling Jobs", icon: ClipboardList },
  { to: "/models", label: "Models", icon: Box },
  {
    to: "/insights",
    label: "Insights",
    icon: BarChart3,
    roles: ["ADMIN", "REVIEWER"],
  },
  { to: "/admin", label: "Settings", icon: Settings },
];

export function DashboardLayout({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  // Auto-select first project if none selected
  const currentProject =
    projects?.find((p) => p.id === activeProjectId) ?? projects?.[0];
  if (currentProject && activeProjectId !== currentProject.id) {
    setActiveProject(currentProject.id);
  }

  return (
    <div className="h-screen bg-background text-foreground">
      <div className="flex h-full">
        <aside className="hidden w-64 border-r border-border bg-card px-4 py-6 md:flex md:flex-col overflow-y-auto">
          <img src={spektraLogo} alt="spektra" className="h-7 w-auto" />
          <Separator className="my-4" />
          <nav className="flex-1 space-y-1">
            {navItems
              .filter(
                (item) =>
                  !("roles" in item && item.roles) ||
                  (authUser?.role && item.roles?.includes(authUser.role)),
              )
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    ].join(" ")
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
          </nav>
          <div className="space-y-2">
            {authUser && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{authUser.email}</span>
                <button
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                  className="ml-1 p-1 hover:text-foreground"
                  title="Log out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="text-xs text-muted-foreground">v1.0</div>
            <div className="text-xs text-muted-foreground">
              by Tomasz Zakrzewski
            </div>
          </div>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
            <div className="flex items-center gap-3">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" className="md:hidden">
                    Menu
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <div className="text-lg font-semibold">spektra</div>
                  <Separator className="my-4" />
                  <nav className="space-y-2">
                    {navItems
                      .filter(
                        (item) =>
                          !("roles" in item && item.roles) ||
                          (authUser?.role &&
                            item.roles?.includes(authUser.role)),
                      )
                      .map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) =>
                            [
                              "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                              isActive
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:bg-muted",
                            ].join(" ")
                          }
                        >
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </NavLink>
                      ))}
                  </nav>
                </SheetContent>
              </Sheet>
              {projects && projects.length > 1 ? (
                <select
                  className="bg-transparent text-lg font-semibold outline-none"
                  value={currentProject?.id ?? ""}
                  onChange={(e) => setActiveProject(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-lg font-semibold">
                  {currentProject?.name ?? "No project"}
                </div>
              )}
            </div>
            <Button variant="secondary" onClick={() => navigate("/jobs")}>
              New Job
            </Button>
          </header>

          <main className="flex-1 flex min-h-0 min-w-0 flex-col overflow-x-hidden px-6 py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
