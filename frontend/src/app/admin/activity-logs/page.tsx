"use client";

import { useEffect, useState, useCallback } from "react";
import { getActivityLogs, getActivityStats } from "@/services/adminApi";
import {
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Activity,
  CheckCircle2,
  XCircle,
  User,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ActivityLog = {
  id: number;
  user_id: number | null;
  user_email: string;
  activity_type: string;
  action: string;
  description: string | null;
  event_id: number | null;
  order_id: number | null;
  ip_address: string | null;
  status: string;
  error_message: string | null;
  created_at: string | null;
};

type ActivityStats = {
  period_days: number;
  activity_breakdown: Array<{
    type: string;
    status: string;
    count: number;
  }>;
  daily_trend: Array<{
    date: string;
    count: number;
  }>;
  top_users: Array<{
    email: string;
    count: number;
  }>;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 size={12} className="text-emerald-400" />,
  failed: <XCircle size={12} className="text-red-400" />,
  error: <XCircle size={12} className="text-red-400" />,
};

const STATUS_BADGE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
  error: "bg-red-500/15 text-red-400",
};

const ACTIVITY_TYPE_COLORS: Record<string, string> = {
  login: "text-blue-400",
  logout: "text-zinc-400",
  login_failed: "text-red-400",
  event_create: "text-emerald-400",
  event_update: "text-amber-400",
  event_delete: "text-red-400",
  photo_upload: "text-blue-400",
  photo_download: "text-violet-400",
  face_search: "text-cyan-400",
  face_match: "text-emerald-400",
  payment_success: "text-emerald-400",
  payment_failed: "text-red-400",
  admin_user_create: "text-violet-400",
  admin_user_delete: "text-red-400",
};

const ACTIVITY_TYPES = [
  { value: "", label: "All Types" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "login_failed", label: "Failed Login" },
  { value: "event_create", label: "Event Create" },
  { value: "event_update", label: "Event Update" },
  { value: "event_delete", label: "Event Delete" },
  { value: "photo_upload", label: "Photo Upload" },
  { value: "photo_download", label: "Photo Download" },
  { value: "face_search", label: "Face Search" },
  { value: "payment_success", label: "Payment Success" },
  { value: "payment_failed", label: "Payment Failed" },
  { value: "admin_user_create", label: "Admin: User Create" },
  { value: "admin_user_delete", label: "Admin: User Delete" },
];

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activityType, setActivityType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadLogs = useCallback(() => {
    setLoading(true);
    Promise.all([
      getActivityLogs({ page, limit: 30, search, activity_type: activityType, status }),
      getActivityStats(7),
    ])
      .then(([logsData, statsData]) => {
        setLogs(logsData.logs);
        setTotal(logsData.total);
        setTotalPages(logsData.total_pages);
        setStats(statsData);
      })
      .finally(() => setLoading(false));
  }, [page, search, activityType, status]);

  useEffect(() => { loadLogs(); }, [loadLogs]);
  useEffect(() => { setPage(1); }, [search, activityType, status]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Activity Logs</h1>
        <p className="text-xs text-zinc-600 mt-0.5">
          {total} total activities recorded
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Total Activities</span>
              <Activity size={14} className="text-blue-400" />
            </div>
            <p className="text-xl font-bold text-zinc-100">
              {stats.daily_trend.reduce((sum, d) => sum + d.count, 0)}
            </p>
            <p className="text-[10px] text-zinc-600 mt-1">last {stats.period_days} days</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Success Rate</span>
              <CheckCircle2 size={14} className="text-emerald-400" />
            </div>
            <p className="text-xl font-bold text-zinc-100">
              {stats.activity_breakdown.length > 0
                ? Math.round(
                    (stats.activity_breakdown.filter(a => a.status === "success").reduce((s, a) => s + a.count, 0) /
                      Math.max(1, stats.activity_breakdown.reduce((s, a) => s + a.count, 0))) *
                      100
                  )
                : 0}%
            </p>
            <p className="text-[10px] text-zinc-600 mt-1">success rate</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Failed Attempts</span>
              <XCircle size={14} className="text-red-400" />
            </div>
            <p className="text-xl font-bold text-zinc-100">
              {stats.activity_breakdown.filter(a => a.status === "failed").reduce((s, a) => s + a.count, 0)}
            </p>
            <p className="text-[10px] text-zinc-600 mt-1">failed actions</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Top User</span>
              <User size={14} className="text-violet-400" />
            </div>
            <p className="text-sm font-medium text-zinc-300 truncate">
              {stats.top_users[0]?.email || "No activity"}
            </p>
            <p className="text-[10px] text-zinc-600 mt-1">
              {stats.top_users[0]?.count || 0} activities
            </p>
          </div>
        </div>
      )}

      {/* Activity Chart */}
      {stats && stats.daily_trend.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Activity Trend (Last 7 Days)</h2>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.daily_trend}>
                <defs>
                  <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  tickFormatter={(v) => new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  stroke="#27272a"
                />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} stroke="#27272a" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "8px",
                    fontSize: "11px",
                  }}
                  labelFormatter={(v) => new Date(v).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorActivity)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by action, IP, description…"
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-zinc-700 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700"
          />
        </div>
        <select
          value={activityType}
          onChange={(e) => setActivityType(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 focus:outline-none"
        >
          {ACTIVITY_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 focus:outline-none"
        >
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="error">Error</option>
        </select>
      </div>

      {/* Logs Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={20} className="animate-spin text-zinc-600" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  {["User", "Activity", "Details", "IP Address", "Status", "Time"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-medium text-zinc-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-zinc-300 truncate max-w-[130px]">{log.user_email}</p>
                      <p className="text-[10px] text-zinc-600">ID: {log.user_id || "anon"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className={`font-medium capitalize ${ACTIVITY_TYPE_COLORS[log.activity_type] || "text-zinc-400"}`}>
                        {log.activity_type.replace(/_/g, " ")}
                      </p>
                      <p className="text-[10px] text-zinc-600 truncate max-w-[120px]">{log.action}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-400 truncate max-w-[150px]">{log.description || "—"}</p>
                      {(log.event_id || log.order_id) && (
                        <p className="text-[10px] text-zinc-600">
                          {log.event_id && `Event: #${log.event_id}`}
                          {log.order_id && ` Order: #${log.order_id}`}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-500 font-mono text-[11px]">{log.ip_address || "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[log.status] || "bg-zinc-800 text-zinc-600"}`}>
                        <span className="flex items-center gap-1">
                          {STATUS_ICON[log.status]}
                          {log.status}
                        </span>
                      </span>
                      {log.error_message && (
                        <p className="text-[10px] text-red-400 truncate max-w-[100px] mt-1">{log.error_message}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-500">{formatDate(log.created_at)}</p>
                    </td>
                  </tr>
                ))}
                {!logs.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-xs text-zinc-600">
                      No activity logs found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
            <span className="text-[11px] text-zinc-600">
              Page {page} of {totalPages} • {total} total
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-500"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-500"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
