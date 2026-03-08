"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, ArrowLeft, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import API from "@/services/api";
import { APP_CONFIG } from "@/config/app";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const token        = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [message,  setMessage]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) { setError("Invalid or expired reset link."); return; }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await API.post(`/auth/reset-password?token=${token}&new_password=${encodeURIComponent(password)}`);
      setMessage("Password reset successful. Redirecting…");
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setError("Reset failed. The link may have expired.");
    } finally {
      setLoading(false);
    }
  };

  const strength = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : 3;
  const strengthLabel = ["", "Weak", "Fair", "Strong"][strength];
  const strengthColor = ["", "bg-red-500", "bg-amber-500", "bg-emerald-500"][strength];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-7 pt-8 pb-6 text-center border-b border-zinc-800">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-4 border ${
          message
            ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
            : "bg-blue-500/10 border-blue-500/25 text-blue-400"
        }`}>
          {message ? <CheckCircle2 size={16} /> : <Lock size={16} />}
        </div>
        <h1 className="text-sm font-bold tracking-tight text-zinc-50">
          {message ? "Password Reset!" : "Set new password"}
        </h1>
        <p className="text-[11px] text-zinc-600 mt-1">
          {message ? "You can now sign in." : "Choose a strong password for your account"}
        </p>
      </div>

      <div className="px-7 py-6">
        <AnimatePresence mode="wait">
          {message ? (
            <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-3 py-2 text-center">
              <p className="text-xs text-zinc-400">{message}</p>
              <Link href="/login" className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors">
                Go to Sign In →
              </Link>
            </motion.div>
          ) : (
            <motion.form key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              exit={{ opacity: 0 }} onSubmit={handleReset} className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-500 block mb-1.5">New Password</label>
                <div className="relative">
                  <input type={showPw ? "text" : "password"} required value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="••••••••" minLength={6}
                    className="w-full px-3 py-2.5 pr-9 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors" />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors">
                    {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3].map(i => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? strengthColor : "bg-zinc-800"}`} />
                      ))}
                    </div>
                    <p className="text-[10px] text-zinc-500">{strengthLabel}</p>
                  </div>
                )}
              </div>
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertCircle size={11} className="flex-shrink-0" /> {error}
                  </motion.div>
                )}
              </AnimatePresence>
              <button type="submit" disabled={loading || strength < 1}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors">
                {loading && <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />}
                {loading ? "Resetting…" : "Reset Password"}
              </button>
              <p className="text-center text-[11px] text-zinc-600 pt-1">
                <Link href="/login" className="text-blue-400 hover:text-blue-300 transition-colors">Back to Sign In</Link>
              </p>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="relative min-h-screen bg-zinc-950 flex items-center justify-center overflow-hidden antialiased">
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-64 rounded-full bg-blue-600/12 blur-[100px]" />
      <div className="absolute top-0 inset-x-0 h-12 border-b border-zinc-800/60 flex items-center justify-between px-6 z-20">
        <Link href="/" className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors group">
          <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" />
          Back to Home
        </Link>
        <span className="text-[11px] text-zinc-600">Secure Authentication</span>
      </div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }} className="relative z-10 w-full max-w-sm px-5">
        {/* Suspense required — ResetPasswordForm uses useSearchParams() */}
        <Suspense fallback={<div className="bg-zinc-900 border border-zinc-800 rounded-2xl h-64 animate-pulse" />}>
          <ResetPasswordForm />
        </Suspense>
        <p className="text-center text-[11px] text-zinc-700 mt-4">
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </p>
      </motion.div>
    </div>
  );
}