"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import API from "@/services/api";
import { Loader2, ArrowLeft, Scan, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { APP_CONFIG } from "@/config/app";

export default function AuthPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const initialMode  = searchParams.get("mode") === "register" ? "register" : "login";

  const [mode,     setMode]     = useState<"login" | "register">(initialMode);
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const res = await API.post(endpoint, { email, password });
      localStorage.setItem("token", res.data.access_token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      window.location.href = "/dashboard";
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
        (mode === "login" ? "Invalid email or password" : "Registration failed")
      );
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setError("");
  };

  return (
    <div className="relative min-h-screen bg-zinc-950 flex items-center justify-center overflow-hidden antialiased">

      {/* Ambient glows */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-64 rounded-full bg-blue-600/12 blur-[100px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 w-80 h-80 rounded-full bg-violet-600/8 blur-[100px]" />

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 h-12 border-b border-zinc-800/60 flex items-center justify-between px-6 z-20">
        <Link href="/" className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors group">
          <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" />
          Back to Home
        </Link>
        <span className="text-[11px] text-zinc-600">Secure Authentication</span>
      </div>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative z-10 w-full max-w-sm px-5"
      >
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

          {/* Header */}
          <div className="px-7 pt-8 pb-6 text-center border-b border-zinc-800">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mx-auto mb-4">
              <Scan size={16} className="text-white" />
            </div>
            <h1 className="text-sm font-bold tracking-tight text-zinc-50">{APP_CONFIG.name}</h1>
            <p className="text-[11px] text-zinc-600 mt-0.5">AI-powered event photo platform</p>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-zinc-800">
            {(["login", "register"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => switchMode(tab)}
                className={`flex-1 py-3 text-xs font-medium transition-colors ${
                  mode === tab
                    ? "text-zinc-100 bg-zinc-800/60"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {tab === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="px-7 py-6">
            <AnimatePresence mode="wait">
              <motion.form
                key={mode}
                initial={{ opacity: 0, x: mode === "login" ? -8 : 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleSubmit}
                className="space-y-3"
              >
                {/* Email */}
                <div>
                  <label className="text-[11px] font-medium text-zinc-500 block mb-1.5">Email address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="text-[11px] font-medium text-zinc-500 block mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2.5 pr-9 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  {mode === "login" && (
                    <div className="text-right mt-1.5">
                      <Link href="/forgot-password" className="text-[10px] text-zinc-600 hover:text-blue-400 transition-colors">
                        Forgot password?
                      </Link>
                    </div>
                  )}
                </div>

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="text-[11px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2 text-center"
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors mt-1"
                >
                  {loading && <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />}
                  {loading ? "Processing…" : mode === "login" ? "Sign In" : "Create Account"}
                </button>
              </motion.form>
            </AnimatePresence>
          </div>
        </div>

        <p className="text-center text-[11px] text-zinc-700 mt-4">
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </p>
      </motion.div>
    </div>
  );
}