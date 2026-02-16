import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiLogin, apiMe, apiRegister } from "../lib/api";
import { useAuthStore } from "../store/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isRegister) {
        await apiRegister(email, password);
      }
      const { access_token } = await apiLogin(email, password);
      // Temporarily store token so apiMe works
      localStorage.setItem("spektra_token", access_token);
      const user = await apiMe();
      setAuth(access_token, user);
      navigate("/gallery");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      localStorage.removeItem("spektra_token");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6"
      >
        <h1 className="text-xl font-semibold">
          {isRegister ? "Create Account" : "Sign In"}
        </h1>

        {error && (
          <p className="rounded bg-red-900/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="space-y-1">
          <label className="text-sm text-zinc-400" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-zinc-400" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-blue-600 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Loading…" : isRegister ? "Register" : "Sign In"}
        </button>

        <p className="text-center text-xs text-zinc-500">
          {isRegister ? "Already have an account?" : "No account?"}{" "}
          <button
            type="button"
            className="text-blue-400 hover:underline"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
          >
            {isRegister ? "Sign in" : "Register"}
          </button>
        </p>
      </form>
    </div>
  );
}
