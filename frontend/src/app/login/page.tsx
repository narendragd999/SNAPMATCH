"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import API from "@/services/api";
import { ArrowLeft, Scan, Eye, EyeOff, Mail, ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { APP_CONFIG } from "@/config/app";

interface OTPConfig {
  otp_required: boolean;
  dev_mode: boolean;
  otp_length: number;
  otp_expiry_minutes: number;
}

function AuthForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const initialMode  = searchParams.get("mode") === "register" ? "register" : "login";

  const [mode,     setMode]     = useState<"login" | "register">(initialMode);
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");

  // OTP state
  const [otpConfig, setOtpConfig] = useState<OTPConfig | null>(null);
  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [trustDevice, setTrustDevice] = useState(true);

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

  const handleSendOtp = async () => {
    if (!email) {
      setError("Please enter your email address");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await API.post("/auth/send-otp", {
        email,
        purpose: mode === "register" ? "registration" : "login"
      });

      setOtpSent(true);
      setResendTimer(60);

      if (res.data.dev_otp) {
        setSuccess(`Development Mode: Your OTP is ${res.data.dev_otp}`);
      } else {
        setSuccess("OTP sent to your email. Please check your inbox.");
      }

      setShowOtpStep(true);
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || "Failed to send OTP. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length !== (otpConfig?.otp_length || 6)) {
      setError(`Please enter a valid ${otpConfig?.otp_length || 6}-digit OTP`);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const verifyRes = await API.post("/auth/verify-otp", {
        email,
        otp_code: otpCode,
        purpose: mode === "register" ? "registration" : "login",
        trust_device: mode === "login" && trustDevice
      });

      if (!verifyRes.data.verified) {
        setError(verifyRes.data.message || "OTP verification failed");
        return;
      }

      if (mode === "register") {
        const regRes = await API.post("/auth/register-with-otp", {
          email,
          password,
          otp_code: otpCode
        });
        handleAuthSuccess(regRes);
      } else {
        const loginRes = await API.post("/auth/login-with-otp", {
          email,
          password,
          otp_code: otpCode,
          trust_device: trustDevice
        });
        handleAuthSuccess(loginRes);
      }
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || "Verification failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSuccess = (res: any) => {
    localStorage.setItem("token", res.data.access_token);
    localStorage.setItem("user", JSON.stringify(res.data.user));
    
    if (res.data.device_trusted) {
      console.log("Device trusted for 30 days");
    }
    
    if (res.data.user?.role === "admin") {
      window.location.href = "/admin";
    } else {
      window.location.href = "/dashboard";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    // Validation for registration
    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    // ── If already in OTP verification step, just verify ──
    if (showOtpStep) {
      setLoading(false);
      handleVerifyOtp();
      return;
    }

    // ── LOGIN: Try direct login first ──
    // This succeeds for: dev mode OR trusted device
    // This returns 403 for: new/untrusted device in production
    if (mode === "login") {
      try {
        const res = await API.post("/auth/login", { email, password });
        handleAuthSuccess(res);
        return;
      } catch (loginErr: any) {
        // Backend says OTP required → switch to OTP flow
        if (
          loginErr?.response?.status === 403 &&
          loginErr?.response?.data?.detail?.otp_required
        ) {
          setLoading(false);
          handleSendOtp();
          return;
        }
        // Real error (bad credentials, etc.)
        const errorDetail = loginErr?.response?.data?.detail;
        setError(
          typeof errorDetail === "string"
            ? errorDetail
            : errorDetail?.message || "Invalid email or password."
        );
        setLoading(false);
      }
      return;
    }

    // ── REGISTER ──
    if (otpConfig?.otp_required) {
      // Production: need OTP verification before registration
      setLoading(false);
      handleSendOtp();
    } else {
      // Dev mode: direct registration
      try {
        const res = await API.post("/auth/register", { email, password });
        handleAuthSuccess(res);
      } catch (err: any) {
        const errorDetail = err?.response?.data?.detail;
        setError(
          typeof errorDetail === "string"
            ? errorDetail
            : errorDetail?.message || "Registration failed. Try again."
        );
        setLoading(false);
      }
    }
  };

  const handleResendOtp = async () => {
    if (resendTimer > 0) return;
    await handleSendOtp();
  };

  const handleBack = () => {
    setShowOtpStep(false);
    setOtpCode("");
    setOtpSent(false);
    setError("");
    setSuccess("");
  };

  const resetForm = () => {
    setShowOtpStep(false);
    setOtpCode("");
    setOtpSent(false);
    setError("");
    setSuccess("");
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-7 pt-8 pb-6 text-center border-b border-zinc-800">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mx-auto mb-4">
          <Scan size={16} className="text-white" />
        </div>
        <h1 className="text-sm font-bold text-zinc-100">{APP_CONFIG.name}</h1>
        <p className="text-[11px] text-zinc-500 mt-1">AI-powered event photo management</p>
      </div>

      {!showOtpStep && (
        <div className="flex border-b border-zinc-800">
          {(["login", "register"] as const).map(tab => (
            <button key={tab} onClick={() => { setMode(tab); resetForm(); setError(""); }}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                mode === tab ? "text-zinc-100 bg-zinc-800/60" : "text-zinc-600 hover:text-zinc-400"
              }`}>
              {tab === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>
      )}

      <div className="px-7 py-6">
        <AnimatePresence mode="wait">
          {showOtpStep ? (
            <motion.div
              key="otp-step"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="text-center mb-4">
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
                  <Mail size={20} className="text-blue-400" />
                </div>
                <h3 className="text-sm font-medium text-zinc-100">Verify your email</h3>
                <p className="text-[11px] text-zinc-500 mt-1">
                  We sent a code to <span className="text-zinc-300">{email}</span>
                </p>
              </div>

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

              {mode === "login" && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trustDevice}
                    onChange={(e) => setTrustDevice(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500/50"
                  />
                  <span className="text-[11px] text-zinc-400">
                    Remember this device for 30 days
                  </span>
                </label>
              )}

              <div className="flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  onClick={handleBack}
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
                  <RefreshCw size={12} className={resendTimer > 0 ? "" : "animate-spin"} />
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend Code"}
                </button>
              </div>

              {success && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-center"
                >
                  {success}
                </motion.p>
              )}

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2 text-center"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || otpCode.length !== (otpConfig?.otp_length || 6)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors"
              >
                {loading && <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />}
                {loading ? "Verifying…" : "Verify & Continue"}
                <ArrowRight size={14} />
              </button>
            </motion.div>
          ) : (
            <motion.form
              key={mode}
              initial={{ opacity: 0, x: mode === "login" ? -8 : 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onSubmit={handleSubmit}
              className="space-y-3"
            >
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
                    <Link
                      href="/forgot-password"
                      className="text-[10px] text-zinc-600 hover:text-blue-400 transition-colors"
                    >
                      Forgot password?
                    </Link>
                  </div>
                )}
              </div>

              {mode === "register" && (
                <div>
                  <label className="text-[11px] font-medium text-zinc-500 block mb-1.5">Confirm Password</label>
                  <input
                    type={showPw ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors"
                  />
                </div>
              )}

              {otpConfig?.dev_mode && (
                <p className="text-[10px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  Development Mode: OTP verification is optional. Common OTP: <code className="font-mono">123456</code>
                </p>
              )}

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2 text-center"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors mt-1"
              >
                {loading && <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />}
                {loading
                  ? "Signing in…"
                  : mode === "login"
                    ? "Sign In"
                    : "Create Account"
                }
                <ArrowRight size={14} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function LoginPage() {
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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative z-10 w-full max-w-sm px-5"
      >
        <Suspense fallback={<div className="bg-zinc-900 border border-zinc-800 rounded-2xl h-80 animate-pulse" />}>
          <AuthForm />
        </Suspense>
        <p className="text-center text-[11px] text-zinc-700 mt-4">
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </p>
      </motion.div>
    </div>
  );
}