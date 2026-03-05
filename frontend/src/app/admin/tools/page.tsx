"use client";

import { useState, useEffect } from "react";
import { triggerCleanup } from "@/services/adminApi";
import {
  Trash2, Loader2, ShieldAlert, CheckCircle2, Info,
  ToggleLeft, ToggleRight,   // ← ADD
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL;
const authH = () => ({ Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` });

type ToolResult = { status: "idle" | "running" | "done" | "error"; msg: string };

export default function AdminToolsPage() {
  const [cleanup,       setCleanup]       = useState<ToolResult>({ status: "idle", msg: "" });
  const [uploadEnabled, setUploadEnabled] = useState(false);

  const runCleanup = async () => {
    setCleanup({ status: "running", msg: "" });
    try {
      const res = await triggerCleanup();
      setCleanup({ status: "done", msg: res.message || "Cleanup task dispatched" });
    } catch (e: any) {
      setCleanup({ status: "error", msg: e?.response?.data?.detail || "Failed to trigger cleanup" });
    }
  };

  const tools = [
    {
      id:          "cleanup",
      title:       "Expired Events Cleanup",
      description: "Scans all events where expires_at has passed, then deletes their clusters, FAISS indexes, storage files, and database records. This is also run automatically every night at 03:00 UTC by Celery Beat.",
      icon:        Trash2,
      action:      runCleanup,
      state:       cleanup,
      buttonLabel: "Run Cleanup Now",
    },
  ];

  // Load settings on mount
  useEffect(() => {
    fetch(`${API}/admin/settings`, { headers: authH() })
      .then(r => r.json())
      .then(data => setUploadEnabled(data.upload_photo_enabled === "true"))
      .catch(() => {});
  }, []);

  const toggleUpload = async () => {
    const next = !uploadEnabled;
    try {
      await fetch(`${API}/admin/settings`, {
        method:  "PATCH",
        headers: { ...authH(), "Content-Type": "application/json" },
        body:    JSON.stringify({ upload_photo_enabled: String(next) }),
      });
      setUploadEnabled(next);
    } catch {}
  };

  return (
    <div className="space-y-7 max-w-2xl">
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Tools</h1>
        <p className="text-xs text-zinc-600 mt-0.5">Manual system maintenance operations</p>
      </div>

      <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
        <ShieldAlert size={15} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80 leading-relaxed">
          These tools perform irreversible operations on the database and filesystem.
          Use with caution in production.
        </p>
      </div>

      {/* ── Platform Settings ── */}
      <div>
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Platform Settings
        </h2>
        <div className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
          <div>
            <p className="text-sm font-medium text-zinc-100">Upload Photo on Public Page</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Allow guests to upload a photo file in addition to taking a selfie.
              Keep disabled in production — enable only for development/testing.
            </p>
          </div>
          <button
            onClick={toggleUpload}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              uploadEnabled
                ? "bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {uploadEnabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            {uploadEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      {/* ── Maintenance Tools ── */}
      <div className="space-y-3">
        {tools.map(tool => {
          const Icon = tool.icon;
          const { status, msg } = tool.state;
          return (
            <div key={tool.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                  <Icon size={14} className="text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">{tool.title}</h2>
                  <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{tool.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={tool.action}
                  disabled={status === "running"}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-300 transition-colors disabled:opacity-60"
                >
                  {status === "running"
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Icon    size={13} />}
                  {status === "running" ? "Running…" : tool.buttonLabel}
                </button>

                {status === "done" && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 size={12} /> {msg}
                  </span>
                )}
                {status === "error" && (
                  <span className="flex items-center gap-1.5 text-xs text-red-400">
                    <ShieldAlert size={12} /> {msg}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Scheduled Tasks ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Info size={13} className="text-zinc-600" />
          <h2 className="text-xs font-semibold text-zinc-400">Scheduled Tasks (Celery Beat)</h2>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left pb-2 text-[11px] text-zinc-600 font-medium">Task</th>
              <th className="text-left pb-2 text-[11px] text-zinc-600 font-medium">Schedule</th>
              <th className="text-left pb-2 text-[11px] text-zinc-600 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-2 text-zinc-400">cleanup_expired_events</td>
              <td className="py-2 text-zinc-600">Daily at 03:00 UTC</td>
              <td className="py-2 text-zinc-600">Delete expired events + files</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}