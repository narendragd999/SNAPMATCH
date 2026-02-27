"use client";

import { useEffect, useState, useCallback } from "react";
import { getAdminEvents, deleteAdminEvent } from "@/services/adminApi";
import {
  Search,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Hourglass,
} from "lucide-react";

type EventRow = {
  id: number;
  name: string;
  owner_email: string;
  owner_plan: string;
  processing_status: string;
  image_count: number;
  total_faces: number;
  total_clusters: number;
  public_status: string;
  expires_at: string | null;
  created_at: string;
};

type EventList = {
  events: EventRow[];
  total: number;
  page: number;
  total_pages: number;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  completed:  <CheckCircle2 size={13} className="text-emerald-400" />,
  processing: <Loader2      size={13} className="text-blue-400 animate-spin" />,
  failed:     <AlertCircle  size={13} className="text-red-400"     />,
  pending:    <Hourglass    size={13} className="text-zinc-500"    />,
  queued:     <Clock        size={13} className="text-amber-400"   />,
};

const PLAN_BADGE: Record<string, string> = {
  free:       "text-zinc-500",
  pro:        "text-blue-400",
  enterprise: "text-violet-400",
};

export default function AdminEventsPage() {
  const [data,     setData]     = useState<EventList | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [status,   setStatus]   = useState("");
  const [page,     setPage]     = useState(1);
  const [confirm,  setConfirm]  = useState<EventRow | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAdminEvents({ page, limit: 20, search, status })
      .then(setData)
      .finally(() => setLoading(false));
  }, [page, search, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status]);

  const handleDelete = async (event: EventRow) => {
    setDeleting(event.id);
    try {
      await deleteAdminEvent(event.id);
      load();
    } finally {
      setDeleting(null);
      setConfirm(null);
    }
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Events</h1>
        <p className="text-xs text-zinc-600 mt-0.5">
          {data ? `${data.total} total events` : "Loading…"}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by event name…"
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-zinc-700 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="processing">Processing</option>
          <option value="pending">Pending</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
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
                  {["Event", "Owner", "Status", "Images", "Faces", "Public", "Expires", "Actions"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-medium text-zinc-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.events.map(ev => (
                  <tr key={ev.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-zinc-300 font-medium truncate max-w-[140px]">{ev.name}</p>
                      <p className="text-[10px] text-zinc-600">#{ev.id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-400 truncate max-w-[130px]">{ev.owner_email}</p>
                      <p className={`text-[10px] capitalize font-medium ${PLAN_BADGE[ev.owner_plan] || "text-zinc-600"}`}>
                        {ev.owner_plan}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {STATUS_ICON[ev.processing_status] || <XCircle size={13} className="text-zinc-600" />}
                        <span className="capitalize text-zinc-400">{ev.processing_status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{ev.image_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-500">{ev.total_faces.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        ev.public_status === "active"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                          : "bg-zinc-800 text-zinc-600"
                      }`}>
                        {ev.public_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ev.expires_at ? (
                        <span className={`text-[11px] ${isExpired(ev.expires_at) ? "text-red-400" : "text-zinc-500"}`}>
                          {isExpired(ev.expires_at) ? "Expired " : ""}
                          {new Date(ev.expires_at).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-zinc-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setConfirm(ev)}
                        className="text-zinc-600 hover:text-red-400 transition-colors"
                      >
                        {deleting === ev.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2   size={13} />
                        }
                      </button>
                    </td>
                  </tr>
                ))}
                {!data?.events.length && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-xs text-zinc-600">
                      No events found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
            <span className="text-[11px] text-zinc-600">
              Page {data.page} of {data.total_pages}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-500"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= (data?.total_pages ?? 1)}
                className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-500"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-100">Delete Event?</h2>
            <p className="text-xs text-zinc-500 leading-relaxed">
              This will permanently delete <span className="text-zinc-300">"{confirm.name}"</span>,
              including all images, face data, and FAISS indexes. Cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="flex-1 py-2.5 rounded-lg border border-zinc-800 text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirm)}
                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium"
              >
                Delete Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}