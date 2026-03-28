"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Mail, ArrowLeft, CheckCircle2, Lock, RefreshCw, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import API from "@/services/api";
import { APP_CONFIG } from "@/config/app";

interface OTPConfig {
  otp_required: boolean;
  dev_mode: boolean;
  otp_length: number;
  otp_expiry_minutes: number;
}

export default function ForgotPassword() {
  const [step, setStep] = useState<"email" | "otp" | "reset" | "success">("email");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [otpConfig, setOtpConfig] = useState<OTPConfig | null>(null);

  // Fetch OTP config on mount
  useEffect(() => {
    const fetchOtpConfig = async () => {
      try {
        const res = await API.get("/auth/otp-config");
        setOtpConfig(res.data);
      } catch (err) {
        console.error("Failed to fetch OTP config:", err);
        setOtpConfig({
          otp_required: false,
          dev_mode: true,
          otp_length: 6,
          otp_expiry_minutes: 10
        });
      }
    };
    fetchOtpConfig();
  }, []);

  // Resend timer countdown
  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [resendTimer]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await API.post(`/auth/forgot-password?email=${encodeURIComponent(email)}`);

      if (res.data.dev_otp) {
        setMessage(`Development Mode: Your OTP is ${res.data.dev_otp}`);
      } else {
        setMessage("OTP sent to your email. Please check your inbox.");
      }

      setResendTimer(60);
      setStep("otp");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Verify OTP
      const verifyRes = await API.post("/auth/verify-otp", {
        email,
        otp_code: otpCode,
        purpose: "password_reset"
      });

      if (verifyRes.data.verified) {
        setStep("reset");
        setMessage("");
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || "Invalid OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    try {
      await API.post("/auth/reset-password", null, {
        params: {
          email,
          otp_code: otpCode,
          new_password: newPassword
        }
      });

      setStep("success");
      setMessage("Your password has been reset successfully.");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendTimer > 0) return;
    setLoading(true);
    setError("");

    try {
      const res = await API.post(`/auth/forgot-password?email=${encodeURIComponent(email)}`);
      setResendTimer(60);
      if (res.data.dev_otp) {
        setMessage(`Development Mode: Your OTP is ${res.data.dev_otp}`);
      } else {
        setMessage("OTP sent to your email.");
      }
    } catch {
      setError("Failed to resend OTP.");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (step === "otp") {
      setStep("email");
      setOtpCode("");
      setMessage("");
    } else if (step === "reset") {
      setStep("otp");
      setNewPassword("");
      setConfirmPassword("");
    }
    setError("");
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
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-4 ${
              step === "success" ? "bg-emerald-500/15 border border-emerald-500/25 text-emerald-400" : "bg-blue-500/15 border border-blue-500/25 text-blue-400"
            }`}>
              {step === "success" ? <CheckCircle2 size={16} /> :
               step === "reset" ? <Lock size={16} /> : <Mail size={16} />}
            </div>
            <h1 className="text-sm font-bold tracking-tight text-zinc-50">
              {step === "email" && "Reset your password"}
              {step === "otp" && "Verify your email"}
              {step === "reset" && "Create new password"}
              {step === "success" && "Password reset"}
            </h1>
            <p className="text-[11px] text-zinc-600 mt-1 leading-relaxed">
              {step === "email" && "Enter your email and we'll send you a verification code"}
              {step === "otp" && `We sent a code to ${email}`}
              {step === "reset" && "Enter your new password"}
              {step === "success" && "Your password has been successfully reset"}
            </p>
          </div>

          {/* Content */}
          <div className="px-7 py-6">
            <AnimatePresence mode="wait">
              {step === "success" ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-3 py-4 text-center"
                >
                  <p className="text-xs text-zinc-300 leading-relaxed">{message}</p>
                  <Link
                    href="/login"
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors mt-2"
                  >
                    Continue to Sign In
                  </Link>
                </motion.div>
              ) : step === "email" ? (
                <motion.form
                  key="email"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleSendOtp}
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

                  {/* Dev mode indicator */}
                  {otpConfig?.dev_mode && (
                    <p className="text-[10px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      Development Mode: Common OTP is <code className="font-mono">123456</code>
                    </p>
                  )}

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
                    {loading ? "Sending..." : "Send Verification Code"}
                  </button>

                  <p className="text-center text-[11px] text-zinc-600 pt-1">
                    Remember your password?{" "}
                    <Link href="/login" className="text-blue-400 hover:text-blue-300 transition-colors">
                      Sign in
                    </Link>
                  </p>
                </motion.form>
              ) : step === "otp" ? (
                <motion.form
                  key="otp"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleVerifyOtp}
                  className="space-y-3"
                >
                  <div>
                    <label className="text-[11px] font-medium text-zinc-500 block mb-1.5">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={otpConfig?.otp_length || 6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder={`Enter ${otpConfig?.otp_length || 6}-digit code`}
                      className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors text-center tracking-widest text-lg font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <button
                      type="button"
                      onClick={goBack}
                      className="text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                    >
                      <ArrowLeft size={12} />
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resendTimer > 0}
                      className="text-blue-400 hover:text-blue-300 disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                    >
                      <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                      {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend Code"}
                    </button>
                  </div>

                  {message && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-center"
                    >
                      {message}
                    </motion.p>
                  )}

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
                    disabled={loading || otpCode.length !== (otpConfig?.otp_length || 6)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                  >
                    {loading && <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />}
                    {loading ? "Verifying..." : "Verify Code"}
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="reset"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleResetPassword}
                  className="space-y-3"
                >
                  <div>
                    <label className="text-[11px] font-medium text-zinc-500 block mb-1.5">New Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={6}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3 py-2.5 pr-9 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-zinc-500 block mb-1.5">Confirm Password</label>
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={goBack}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                  >
                    <ArrowLeft size={12} />
                    Back
                  </button>

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
                    disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                  >
                    {loading && <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />}
                    {loading ? "Resetting..." : "Reset Password"}
                  </button>
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
