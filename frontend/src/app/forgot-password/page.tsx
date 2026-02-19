"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import API from "@/services/api";
import { APP_CONFIG } from "@/config/app";

export default function ForgotPassword() {
  const [email,   setEmail]   = useState("");
  const [message, setMessage] = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await API.post(`/auth/forgot-password?email=${encodeURIComponent(email)}`);
      setMessage("If the email exists, a reset link has been sent.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-zinc-950 flex items-center justify-center overflow-hidden antialiased">

      {/* Ambient glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-64 rounded-full bg-blue-600/12 blur-[100px]" />

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
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center mx-auto mb-4 text-blue-400">
              <Mail size={16} />
            </div>
            <h1 className="text-sm font-bold tracking-tight text-zinc-50">Reset your password</h1>
            <p className="text-[11px] text-zinc-600 mt-1 leading-relaxed">
              Enter your email and we'll send you a reset link
            </p>
          </div>

          {/* Form / Success */}
          <div className="px-7 py-6">
            <AnimatePresence mode="wait">
              {message ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-3 py-4 text-center"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 size={18} />
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">{message}</p>
                  <Link
                    href="/login"
                    className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors mt-1"
                  >
                    Back to sign in
                  </Link>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleSubmit}
                  className="space-y-3"
                >
                  <div>
                    <label className="text-[11px] font-medium text-zinc-500 block mb-1.5">Email address</label>
                    <input
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors"
                    />
                  </div>

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

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                  >
                    {loading && <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />}
                    {loading ? "Sending…" : "Send Reset Link"}
                  </button>

                  <p className="text-center text-[11px] text-zinc-600 pt-1">
                    Remember your password?{" "}
                    <Link href="/login" className="text-blue-400 hover:text-blue-300 transition-colors">
                      Sign in
                    </Link>
                  </p>
                </motion.form>
              )}
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