import { create } from "zustand";

export type AuthUser = {
  id: string;
  email: string;
  role: string;
};

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
};

const STORAGE_KEY = "spektra_token";

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem(STORAGE_KEY),
  user: (() => {
    try {
      const raw = localStorage.getItem("spektra_user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })(),
  setAuth: (token, user) => {
    localStorage.setItem(STORAGE_KEY, token);
    localStorage.setItem("spektra_user", JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("spektra_user");
    set({ token: null, user: null });
  },
  isAuthenticated: () => get().token !== null,
}));
