import { create } from "zustand";

const STORAGE_KEY = "spektra:activeProjectId";

type ProjectState = {
  activeProjectId: string | null;
  setActiveProject: (id: string) => void;
};

export const useProjectStore = create<ProjectState>((set) => ({
  activeProjectId: localStorage.getItem(STORAGE_KEY),
  setActiveProject: (id) => {
    localStorage.setItem(STORAGE_KEY, id);
    set({ activeProjectId: id });
  },
}));
