"use client";

import { useEffect, useState, useCallback } from "react";
import { getAdminOrders, getAdminOrder, getAdminOrdersStats } from "@/services/adminApi";
import {
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  IndianRupee,
  Calendar,
  Image,
  Users,
  Gift,
  CreditCard,
  ExternalLink,
  X,
  Eye,
  Copy,
  Check,
} from "lucide-react";

type OrderRow = {
  id: number;
  event_id: number | null;
  event_name: string;
  user_id: number | null;
  user_email: string;
  user_plan: string;
  amount_paise: number;
  amount_inr: number;
  amount_formatted: string;
  photo_quota: number;
  guest_quota: number;
  validity_days: number;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  status: string;
  order_type: string;
  created_at: string | null;
  paid_at: string | null;
  event_status: string;
  event_public_status: string;
  event_expires_at: string | null;
  event_image_count: number;
};

type OrderDetail = {
  id: number;
  event_id: number | null;
  event_name: string;
  user_id: number | null;
  user_email: string;
  user_plan: string;
  user_created_at: string | null;
  amount_paise: number;
  amount_inr: number;
  amount_formatted: string;
  photo_quota: number;
  guest_quota: number;
  validity_days: number;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  status: string;
  order_type: string;
  created_at: string | null;
  paid_at: string | null;
  event: {
    id: number;
    name: string;
    slug: string;
    public_token: string;
    processing_status: string;
    public_status: string;
    expires_at: string | null;
    image_count: number;
    total_faces: number;
    total_clusters: number;
    created_at: string | null;
    is_free_tier: boolean;
  } | null;
  quota: {
    photo_quota: number;
    photos_used: number;
    photos_remaining: number;
    photo_pct: number;
    guest_quota: number;
    guest_used: number;
    guest_remaining: number;
    guest_pct: number;
  } | null;
};

type OrderList = {
  orders: OrderRow[];
  total: number;
  page: number;
  total_pages: number;
};

type OrderStats = {
  total_orders: number;
  status_distribution: Record<string, number>;
  total_revenue_paise: number;
  total_revenue_inr: number;
  total_revenue_formatted: string;
  free_events_count: number;
  paid_events_count: number;
  orders_this_month: number;
  revenue_this_month_paise: number;
  revenue_this_month_inr: number;
  revenue_this_month_formatted: string;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  paid:   <CheckCircle2 size={13} className="text-emerald-400" />,
  free:   <Gift size={13} className="text-violet-400" />,
  created: <Clock size={13} className="text-amber-400" />,
  failed: <XCircle size={13} className="text-red-400" />,
};

const STATUS_BADGE: Record<string, string> = {
  paid:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  free:   "bg-violet-500/15 text-violet-400 border-violet-500/20",
  created: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  failed: "bg-red-500/15 text-red-400 border-red-500/20",
};

const PLAN_BADGE: Record<string, string> = {
  free:       "text-zinc-500",
  pro:        "text-blue-400",
  enterprise: "text-violet-400",
  pay_per_event: "text-amber-400",
};

export default function AdminOrdersPage() {
  const [data, setData] = useState<OrderList | null>(null);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [orderType, setOrderType] = useState("");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      getAdminOrders({ page, limit: 20, search, status, order_type: orderType }),
      getAdminOrdersStats(),
    ])
      .then(([ordersData, statsData]) => {
        setData(ordersData);
        setStats(statsData);
      })
      .finally(() => setLoading(false));
  }, [page, search, status, orderType]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, orderType]);

  const handleViewOrder = async (orderId: number) => {
    setLoadingDetail(true);
    try {
      const detail = await getAdminOrder(orderId);
      setSelectedOrder(detail);
    } finally {
      setLoadingDetail(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

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

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Orders</h1>
        <p className="text-xs text-zinc-600 mt-0.5">
          {data ? `${data.total} total orders` : "Loading…"}
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Total Revenue</span>
              <IndianRupee size={14} className="text-emerald-400" />
            </div>
            <p className="text-xl font-bold text-zinc-100">{stats.total_revenue_formatted}</p>
            <p className="text-[10px] text-zinc-600 mt-1">{stats.paid_events_count} paid events</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">This Month</span>
              <Calendar size={14} className="text-blue-400" />
            </div>
            <p className="text-xl font-bold text-zinc-100">{stats.revenue_this_month_formatted}</p>
            <p className="text-[10px] text-zinc-600 mt-1">{stats.orders_this_month} orders</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Free Events</span>
              <Gift size={14} className="text-violet-400" />
            </div>
            <p className="text-xl font-bold text-zinc-100">{stats.free_events_count}</p>
            <p className="text-[10px] text-zinc-600 mt-1">free tier usage</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Total Orders</span>
              <CreditCard size={14} className="text-amber-400" />
            </div>
            <p className="text-xl font-bold text-zinc-100">{stats.total_orders}</p>
            <p className="text-[10px] text-zinc-600 mt-1">all time</p>
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
            placeholder="Search by event, email, order ID…"
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-zinc-700 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="paid">Paid</option>
          <option value="free">Free</option>
          <option value="created">Created</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={orderType}
          onChange={(e) => setOrderType(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 focus:outline-none"
        >
          <option value="">All Types</option>
          <option value="paid">Paid Orders</option>
          <option value="free">Free Events</option>
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
                  {["Order", "User", "Amount", "Status", "Quota", "Created", "Actions"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-medium text-zinc-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.orders.map((order) => (
                  <tr key={order.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-zinc-300 font-medium truncate max-w-[140px]">{order.event_name}</p>
                      <p className="text-[10px] text-zinc-600">
                        #{order.id} {order.razorpay_order_id && `• ${order.razorpay_order_id.slice(0, 12)}…`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-400 truncate max-w-[130px]">{order.user_email}</p>
                      <p className={`text-[10px] capitalize font-medium ${PLAN_BADGE[order.user_plan] || "text-zinc-600"}`}>
                        {order.user_plan?.replace("_", " ")}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className={`font-medium ${order.amount_paise > 0 ? "text-emerald-400" : "text-violet-400"}`}>
                        {order.amount_formatted}
                      </p>
                      <p className="text-[10px] text-zinc-600">
                        {order.validity_days} days
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${STATUS_BADGE[order.status] || "bg-zinc-800 text-zinc-600"}`}>
                        <span className="flex items-center gap-1">
                          {STATUS_ICON[order.status]}
                          {order.status}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-400">
                        <span className="text-zinc-300">{order.photo_quota}</span> photos
                      </p>
                      <p className="text-[10px] text-zinc-600">
                        +{order.guest_quota} guest
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-500">{formatDate(order.created_at)}</p>
                      {order.paid_at && (
                        <p className="text-[10px] text-emerald-400">Paid: {formatDate(order.paid_at)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleViewOrder(order.id)}
                          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                          title="View Details"
                        >
                          {loadingDetail && selectedOrder?.id === order.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Eye size={13} />
                          )}
                        </button>
                        {order.event_id && (
                          <a
                            href={`/admin/events?search=${order.event_name}`}
                            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                            title="View Event"
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!data?.orders.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-xs text-zinc-600">
                      No orders found
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-500"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= (data?.total_pages ?? 1)}
                className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-500"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Order Details</h2>
                <p className="text-xs text-zinc-500">Order #{selectedOrder.id}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Order Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <p className="text-[10px] text-zinc-500 mb-1">Event Name</p>
                  <p className="text-sm text-zinc-200">{selectedOrder.event_name}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <p className="text-[10px] text-zinc-500 mb-1">User</p>
                  <p className="text-sm text-zinc-200">{selectedOrder.user_email}</p>
                  <p className="text-[10px] text-zinc-500 capitalize">{selectedOrder.user_plan?.replace("_", " ")}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <p className="text-[10px] text-zinc-500 mb-1">Amount</p>
                  <p className={`text-lg font-bold ${selectedOrder.amount_paise > 0 ? "text-emerald-400" : "text-violet-400"}`}>
                    {selectedOrder.amount_formatted}
                  </p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <p className="text-[10px] text-zinc-500 mb-1">Status</p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${STATUS_BADGE[selectedOrder.status] || "bg-zinc-800 text-zinc-600"}`}>
                    <span className="flex items-center gap-1">
                      {STATUS_ICON[selectedOrder.status]}
                      {selectedOrder.status}
                    </span>
                  </span>
                </div>
              </div>

              {/* Quota Info */}
              <div>
                <h3 className="text-xs font-semibold text-zinc-300 mb-3">Quota Details</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-zinc-800/50 rounded-lg p-4 text-center">
                    <Image size={18} className="text-zinc-500 mx-auto mb-2" />
                    <p className="text-lg font-bold text-zinc-200">{selectedOrder.photo_quota}</p>
                    <p className="text-[10px] text-zinc-500">Photo Quota</p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-4 text-center">
                    <Users size={18} className="text-zinc-500 mx-auto mb-2" />
                    <p className="text-lg font-bold text-zinc-200">{selectedOrder.guest_quota}</p>
                    <p className="text-[10px] text-zinc-500">Guest Quota</p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-4 text-center">
                    <Calendar size={18} className="text-zinc-500 mx-auto mb-2" />
                    <p className="text-lg font-bold text-zinc-200">{selectedOrder.validity_days}</p>
                    <p className="text-[10px] text-zinc-500">Validity Days</p>
                  </div>
                </div>
              </div>

              {/* Razorpay Details (if paid order) */}
              {selectedOrder.razorpay_order_id && (
                <div>
                  <h3 className="text-xs font-semibold text-zinc-300 mb-3">Payment Details</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-4 py-3">
                      <div>
                        <p className="text-[10px] text-zinc-500">Order ID</p>
                        <p className="text-xs text-zinc-300 font-mono">{selectedOrder.razorpay_order_id}</p>
                      </div>
                      <button
                        onClick={() => copyToClipboard(selectedOrder.razorpay_order_id || "", "order_id")}
                        className="p-1.5 rounded hover:bg-zinc-700 text-zinc-500"
                      >
                        {copied === "order_id" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                    {selectedOrder.razorpay_payment_id && (
                      <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-4 py-3">
                        <div>
                          <p className="text-[10px] text-zinc-500">Payment ID</p>
                          <p className="text-xs text-zinc-300 font-mono">{selectedOrder.razorpay_payment_id}</p>
                        </div>
                        <button
                          onClick={() => copyToClipboard(selectedOrder.razorpay_payment_id || "", "payment_id")}
                          className="p-1.5 rounded hover:bg-zinc-700 text-zinc-500"
                        >
                          {copied === "payment_id" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Event Details */}
              {selectedOrder.event && (
                <div>
                  <h3 className="text-xs font-semibold text-zinc-300 mb-3">Event Details</h3>
                  <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-zinc-500">Event ID</p>
                        <p className="text-xs text-zinc-300">#{selectedOrder.event.id}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Processing Status</p>
                        <p className="text-xs text-zinc-300 capitalize">{selectedOrder.event.processing_status}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Public Status</p>
                        <p className="text-xs text-zinc-300 capitalize">{selectedOrder.event.public_status}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-zinc-500">Images</p>
                        <p className="text-xs text-zinc-300">{selectedOrder.event.image_count}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Faces</p>
                        <p className="text-xs text-zinc-300">{selectedOrder.event.total_faces}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Clusters</p>
                        <p className="text-xs text-zinc-300">{selectedOrder.event.total_clusters}</p>
                      </div>
                    </div>
                    {selectedOrder.event.expires_at && (
                      <div className="pt-2 border-t border-zinc-700">
                        <p className="text-[10px] text-zinc-500">Expires At</p>
                        <p className={`text-xs ${isExpired(selectedOrder.event.expires_at) ? "text-red-400" : "text-zinc-300"}`}>
                          {formatDate(selectedOrder.event.expires_at)}
                          {isExpired(selectedOrder.event.expires_at) && " (Expired)"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Quota Usage (if available) */}
              {selectedOrder.quota && (
                <div>
                  <h3 className="text-xs font-semibold text-zinc-300 mb-3">Quota Usage</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-zinc-500">Photo Usage</span>
                        <span className="text-[10px] text-zinc-400">
                          {selectedOrder.quota.photos_used} / {selectedOrder.quota.photo_quota} ({selectedOrder.quota.photo_pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${Math.min(selectedOrder.quota.photo_pct, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-zinc-500">Guest Upload Usage</span>
                        <span className="text-[10px] text-zinc-400">
                          {selectedOrder.quota.guest_used} / {selectedOrder.quota.guest_quota} ({selectedOrder.quota.guest_pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full transition-all"
                          style={{ width: `${Math.min(selectedOrder.quota.guest_pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800">
                <div>
                  <p className="text-[10px] text-zinc-500">Created At</p>
                  <p className="text-xs text-zinc-400">{formatDate(selectedOrder.created_at)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500">Paid At</p>
                  <p className="text-xs text-zinc-400">{formatDate(selectedOrder.paid_at)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}