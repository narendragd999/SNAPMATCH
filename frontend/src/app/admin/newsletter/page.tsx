"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Loader2, ArrowLeft, Download, Users, Mail, Calendar, RefreshCw
} from "lucide-react";
import Link from "next/link";

interface Subscriber {
  id: number;
  email: string;
  source: string;
  is_active: boolean;
  subscribed_at: string;
  unsubscribed_at: string | null;
}

interface NewsletterData {
  total: number;
  active: number;
  page: number;
  page_size: number;
  subscribers: Subscriber[];
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080";

export default function AdminNewsletterPage() {
  const [data, setData] = useState<NewsletterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = localStorage.getItem("token");
    setToken(t);
    if (t) fetchSubscribers(t, 1);
  }, []);

  const fetchSubscribers = async (authToken: string, pageNum: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/cms/newsletter?page=${pageNum}&page_size=50`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setPage(pageNum);
      }
    } catch (e) {
      console.error("Failed to fetch subscribers", e);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!token) return;
    setExporting(true);

    try {
      const res = await fetch(`${API}/admin/cms/newsletter/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        // Create downloadable file
        const blob = new Blob([d.emails.join("\n")], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `newsletter-emails-${new Date().toISOString().split("T")[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error("Failed to export", e);
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#090d1a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#6c63ff]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090d1a] text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-400 hover:text-white">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Newsletter Subscribers</h1>
              <p className="text-gray-400 text-sm">
                View and export email subscribers
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => token && fetchSubscribers(token, page)}
              className="flex items-center gap-2 px-4 py-2 border border-white/20 rounded-lg hover:bg-white/5"
            >
              <RefreshCw size={16} />
              Refresh
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleExport}
              disabled={exporting || !data?.active}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] rounded-lg font-medium disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download size={16} />
              )}
              Export Emails
            </motion.button>
          </div>
        </div>

        {/* Stats */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-[#111827] rounded-xl p-5 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#6c63ff]/20 flex items-center justify-center">
                  <Users size={20} className="text-[#6c63ff]" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.total}</p>
                  <p className="text-xs text-gray-400">Total Signups</p>
                </div>
              </div>
            </div>
            <div className="bg-[#111827] rounded-xl p-5 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <Mail size={20} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-400">{data.active}</p>
                  <p className="text-xs text-gray-400">Active</p>
                </div>
              </div>
            </div>
            <div className="bg-[#111827] rounded-xl p-5 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                  <Mail size={20} className="text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-400">{data.total - data.active}</p>
                  <p className="text-xs text-gray-400">Unsubscribed</p>
                </div>
              </div>
            </div>
            <div className="bg-[#111827] rounded-xl p-5 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#3ecfcf]/20 flex items-center justify-center">
                  <Calendar size={20} className="text-[#3ecfcf]" />
                </div>
                <div>
                  <p className="text-sm font-bold">
                    {data.subscribers[0]?.subscribed_at
                      ? new Date(data.subscribers[0].subscribed_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })
                      : "-"}
                  </p>
                  <p className="text-xs text-gray-400">Latest Signup</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Subscribers Table */}
        {data && (
          <div className="bg-[#111827] rounded-xl border border-white/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-4 text-sm font-medium text-gray-400">Email</th>
                    <th className="text-left p-4 text-sm font-medium text-gray-400">Source</th>
                    <th className="text-left p-4 text-sm font-medium text-gray-400">Status</th>
                    <th className="text-left p-4 text-sm font-medium text-gray-400">Subscribed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscribers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center p-8 text-gray-400">
                        No subscribers yet
                      </td>
                    </tr>
                  ) : (
                    data.subscribers.map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors"
                      >
                        <td className="p-4 text-sm">{s.email}</td>
                        <td className="p-4 text-sm text-gray-400">{s.source || "landing_page"}</td>
                        <td className="p-4">
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              s.is_active
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-red-500/20 text-red-400"
                            }`}
                          >
                            {s.is_active ? "Active" : "Unsubscribed"}
                          </span>
                        </td>
                        <td className="p-4 text-sm text-gray-400">
                          {formatDate(s.subscribed_at)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.total > data.page_size && (
              <div className="flex items-center justify-between p-4 border-t border-white/10">
                <p className="text-sm text-gray-400">
                  Showing {(page - 1) * data.page_size + 1} -{" "}
                  {Math.min(page * data.page_size, data.total)} of {data.total}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => token && fetchSubscribers(token, page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1 rounded border border-white/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/5"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => token && fetchSubscribers(token, page + 1)}
                    disabled={page * data.page_size >= data.total}
                    className="px-3 py-1 rounded border border-white/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/5"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}