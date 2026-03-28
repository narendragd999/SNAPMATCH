"use client";

import { useState, useEffect } from "react";
import { triggerCleanup } from "@/services/adminApi";
import {
  Trash2,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  Info,
  ToggleLeft,
  ToggleRight,
  FileDown,
  Download,
  Users,
  Calendar,
  Receipt,
  Activity,
  CalendarDays,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL;
const authH = () => ({ Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` });

type ToolResult = { status: "idle" | "running" | "done" | "error"; msg: string };

const EXPORT_OPTIONS = [
  {
    type: "orders",
    label: "Export Orders",
    description: "All payment orders with user and event details",
    icon: Receipt,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
  },
  {
    type: "users",
    label: "Export Users",
    description: "User accounts with plan and event counts",
    icon: Users,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
  },
  {
    type: "events",
    label: "Export Events",
    description: "All events with processing status and quotas",
    icon: CalendarDays,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
  },
  {
    type: "activity_logs",
    label: "Export Activity Logs",
    description: "User activity and audit trail",
    icon: Activity,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
  },
];

export default function AdminToolsPage() {
  const [cleanup, setCleanup] = useState<ToolResult>({ status: "idle", msg: "" });
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  const runCleanup = async () => {
    setCleanup({ status: "running", msg: "" });
    try {
      const res = await triggerCleanup();
      setCleanup({ status: "done", msg: res.message || "Cleanup task dispatched" });
    } catch (e: any) {
      setCleanup({ status: "error", msg: e?.response?.data?.detail || "Failed to trigger cleanup" });
    }
  };

  const handleExport = async (exportType: string) => {
    setExporting(exportType);
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (dateRange.start) params.append("start_date", dateRange.start);
      if (dateRange.end) params.append("end_date", dateRange.end);

      const response = await fetch(`${API}/admin/export/${exportType}?${params.toString()}`, {
        headers: authH(),
      });

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportType}_export_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert("Export failed. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const tools = [
    {
      id: "cleanup",
      title: "Expired Events Cleanup",
      description: "Scans all events where expires_at has passed, then deletes their clusters, FAISS indexes, storage files, and database records. This is also run automatically every night at 03:00 UTC by Celery Beat.",
      icon: Trash2,
      action: runCleanup,
      state: cleanup,
      buttonLabel: "Run Cleanup Now",
    },
  ];

  // Load settings on mount
  useEffect(() => {
    fetch(`${API}/admin/settings`, { headers: authH() })
      .then((r) => r.json())
      .then((data) => setUploadEnabled(data.upload_photo_enabled === "true"))
      .catch(() => {});
  }, []);

  const toggleUpload = async () => {
    const next = !uploadEnabled;
    try {
      await fetch(`${API}/admin/settings`, {
        method: "PATCH",
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({ upload_photo_enabled: String(next) }),
      });
      setUploadEnabled(next);
    } catch {}
  };

  return (
    <div className="space-y-7 max-w-2xl">
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Tools & Exports</h1>
        <p className="text-xs text-zinc-600 mt-0.5">System maintenance and data export</p>
      </div>

      <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
        <ShieldAlert size={15} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80 leading-relaxed">
          These tools perform irreversible operations on the database and filesystem.
          Use with caution in production.
        </p>
      </div>

      {/* ── Export Reports ─────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Export Reports
        </h2>

        {/* Date Range Filter */}
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-zinc-600">From:</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange((d) => ({ ...d, start: e.target.value }))}
              className="px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-zinc-700"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-zinc-600">To:</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange((d) => ({ ...d, end: e.target.value }))}
              className="px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-zinc-700"
            />
          </div>
          {(dateRange.start || dateRange.end) && (
            <button
              onClick={() => setDateRange({ start: "", end: "" })}
              className="text-[10px] text-zinc-500 hover:text-zinc-400 underline"
            >
              Clear dates
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {EXPORT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isLoading = exporting === opt.type;

            return (
              <div
                key={opt.type}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg ${opt.bgColor} flex items-center justify-center shrink-0`}>
                    <Icon size={15} className={opt.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-zinc-200">{opt.label}</h3>
                    <p className="text-[10px] text-zinc-600 mt-0.5">{opt.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleExport(opt.type)}
                  disabled={isLoading}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-300 transition-colors disabled:opacity-60"
                >
                  {isLoading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  {isLoading ? "Exporting…" : "Export CSV"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Platform Settings ──────────────────────────────────────────────────── */}
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

      {/* ── Maintenance Tools ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Maintenance Tools
        </h2>
        <div className="space-y-3">
          {tools.map((tool) => {
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
                    {status === "running" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Icon size={13} />
                    )}
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
      </div>

      {/* ── Scheduled Tasks ────────────────────────────────────────────────────── */}
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
