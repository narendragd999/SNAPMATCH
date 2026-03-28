"use client";

import { useEffect, useState, useCallback } from "react";
import { getAdminStats, triggerCleanup, getAdminRevenueAnalytics } from "@/services/adminApi";
import {
  Users,
  CalendarDays,
  ImageIcon,
  ScanFace,
  TrendingUp,
  TrendingDown,
  Clock,
  Loader2,
  Trash2,
  IndianRupee,
  ArrowUpRight,
  ArrowDownRight,
  CreditCard,
  Gift,
  ShoppingBag,
  Crown,
  Minus,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

interface Stats {
  total_users: number;
  total_events: number;
  total_images: number;
  total_faces: number;
  plan_distribution: Record<string, number>;
  status_distribution: Record<string, number>;
  new_users_this_week: number;
  expiring_soon: number;
}

interface AnalyticsData {
  period: string;
  period_label: string;
  revenue_trend: Array<{
    date: string;
    revenue: number;
    revenue_formatted: string;
    orders: number;
  }>;
  payment_breakdown: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  mrr: {
    current: number;
    current_formatted: string;
    previous: number;
    previous_formatted: string;
    growth_percent: number;
    trend: string;
  };
  summary: {
    total_revenue: number;
    total_revenue_formatted: string;
    revenue_growth_percent: number;
    total_orders: number;
    avg_order_value: number;
    avg_order_value_formatted: string;
    aov_growth_percent: number;
  };
  top_customers: Array<{
    email: string;
    plan: string;
    orders: number;
    total_spent: number;
    total_formatted: string;
  }>;
  recent_transactions: Array<{
    id: number;
    event_name: string;
    user_email: string;
    amount: number;
    amount_formatted: string;
    status: string;
    date: string;
  }>;
}

const PLAN_COLORS: Record<string, string> = {
  free:       "bg-zinc-700 text-zinc-300",
  pro:        "bg-blue-500/20 text-blue-400",
  enterprise: "bg-violet-500/20 text-violet-400",
};

const STATUS_COLORS: Record<string, string> = {
  completed:  "text-emerald-400",
  processing: "text-blue-400",
  failed:     "text-red-400",
  pending:    "text-zinc-500",
  queued:     "text-amber-400",
};

const PERIOD_OPTIONS = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "12m", label: "12 Months" },
];

const COLORS = ["#10b981", "#8b5cf6", "#f59e0b", "#ef4444"];

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({
    total_users: 0,
    total_events: 0,
    total_images: 0,
    total_faces: 0,
    plan_distribution: {},
    status_distribution: {},
    new_users_this_week: 0,
    expiring_soon: 0,
  });
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState("");
  const [period, setPeriod] = useState("30d");

  useEffect(() => {
    setLoading(true);
    getAdminStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const loadAnalytics = useCallback(() => {
    setAnalyticsLoading(true);
    getAdminRevenueAnalytics(period)
      .then(setAnalytics)
      .finally(() => setAnalyticsLoading(false));
  }, [period]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const handleCleanup = async () => {
    setCleaning(true);
    setCleanMsg("");
    try {
      const res = await triggerCleanup();
      setCleanMsg(`✅ ${res.message}`);
    } catch {
      setCleanMsg("❌ Cleanup failed");
    } finally {
      setCleaning(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (period === "7d" || period === "30d") {
      return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    } else if (period === "90d") {
      return `W${dateStr.split("-W")[1]}`;
    } else {
      return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={22} className="animate-spin text-zinc-600" />
      </div>
    );
  }

  const topCards = [
    { label: "Total Users", value: stats.total_users, icon: Users, color: "text-blue-400", sub: `+${stats.new_users_this_week} this week` },
    { label: "Total Events", value: stats.total_events, icon: CalendarDays, color: "text-violet-400", sub: `${stats.expiring_soon} expiring soon` },
    { label: "Total Images", value: stats.total_images.toLocaleString(), icon: ImageIcon, color: "text-amber-400", sub: "across all events" },
    { label: "Faces Found", value: stats.total_faces.toLocaleString(), icon: ScanFace, color: "text-emerald-400", sub: "processed embeddings" },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Dashboard</h1>
          <p className="text-xs text-zinc-600 mt-0.5">System-wide overview & revenue analytics</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 focus:outline-none"
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Revenue Stats Cards */}
      {analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Total Revenue</span>
              <IndianRupee size={14} className="text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-zinc-100">{analytics.summary.total_revenue_formatted}</p>
            <div className="flex items-center gap-1 mt-1">
              {analytics.summary.revenue_growth_percent > 0 ? (
                <ArrowUpRight size={12} className="text-emerald-400" />
              ) : analytics.summary.revenue_growth_percent < 0 ? (
                <ArrowDownRight size={12} className="text-red-400" />
              ) : (
                <Minus size={12} className="text-zinc-500" />
              )}
              <span className={`text-[10px] ${analytics.summary.revenue_growth_percent > 0 ? "text-emerald-400" : analytics.summary.revenue_growth_percent < 0 ? "text-red-400" : "text-zinc-500"}`}>
                {Math.abs(analytics.summary.revenue_growth_percent)}% vs prev
              </span>
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">MRR</span>
              <TrendingUp size={14} className="text-blue-400" />
            </div>
            <p className="text-2xl font-bold text-zinc-100">{analytics.mrr.current_formatted}</p>
            <div className="flex items-center gap-1 mt-1">
              {analytics.mrr.growth_percent > 0 ? (
                <ArrowUpRight size={12} className="text-emerald-400" />
              ) : analytics.mrr.growth_percent < 0 ? (
                <ArrowDownRight size={12} className="text-red-400" />
              ) : (
                <Minus size={12} className="text-zinc-500" />
              )}
              <span className={`text-[10px] ${analytics.mrr.growth_percent > 0 ? "text-emerald-400" : analytics.mrr.growth_percent < 0 ? "text-red-400" : "text-zinc-500"}`}>
                {Math.abs(analytics.mrr.growth_percent)}% MoM
              </span>
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Avg Order Value</span>
              <ShoppingBag size={14} className="text-amber-400" />
            </div>
            <p className="text-2xl font-bold text-zinc-100">{analytics.summary.avg_order_value_formatted}</p>
            <div className="flex items-center gap-1 mt-1">
              {analytics.summary.aov_growth_percent > 0 ? (
                <ArrowUpRight size={12} className="text-emerald-400" />
              ) : analytics.summary.aov_growth_percent < 0 ? (
                <ArrowDownRight size={12} className="text-red-400" />
              ) : (
                <Minus size={12} className="text-zinc-500" />
              )}
              <span className={`text-[10px] ${analytics.summary.aov_growth_percent > 0 ? "text-emerald-400" : analytics.summary.aov_growth_percent < 0 ? "text-red-400" : "text-zinc-500"}`}>
                {Math.abs(analytics.summary.aov_growth_percent)}% vs prev
              </span>
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-500">Paid Orders</span>
              <CreditCard size={14} className="text-violet-400" />
            </div>
            <p className="text-2xl font-bold text-zinc-100">{analytics.summary.total_orders}</p>
            <p className="text-[10px] text-zinc-600 mt-1">in {analytics.period_label}</p>
          </div>
        </div>
      )}

      {/* Top stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {topCards.map(({ label, value, icon: Icon, color, sub }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-zinc-500">{label}</span>
              <Icon size={14} className={color} />
            </div>
            <p className="text-2xl font-bold text-zinc-100">{value}</p>
            <p className="text-[10px] text-zinc-600 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue Trend Chart */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Revenue Trend</h2>
            <span className="text-[10px] text-zinc-600 ml-auto">{analytics?.period_label}</span>
          </div>
          {analyticsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={20} className="animate-spin text-zinc-600" />
            </div>
          ) : analytics && analytics.revenue_trend.length > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.revenue_trend}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    tickFormatter={formatDate}
                    stroke="#27272a"
                  />
                  <YAxis 
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    stroke="#27272a"
                    tickFormatter={(value) => `₹${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#18181b', 
                      border: '1px solid #27272a',
                      borderRadius: '8px',
                      fontSize: '11px'
                    }}
                    formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Revenue']}
                    labelFormatter={(label) => formatDate(label)}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-zinc-600 text-xs">
              No revenue data available
            </div>
          )}
        </div>

        {/* Payment Breakdown Pie Chart */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Order Distribution</h2>
          </div>
          {analyticsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={20} className="animate-spin text-zinc-600" />
            </div>
          ) : analytics && analytics.payment_breakdown.some(p => p.value > 0) ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.payment_breakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {analytics.payment_breakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#18181b', 
                      border: '1px solid #27272a',
                      borderRadius: '8px',
                      fontSize: '11px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-zinc-600 text-xs">
              No order data
            </div>
          )}
          {/* Legend */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            {analytics?.payment_breakdown.map((item, index) => (
              <div key={item.name} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[10px] text-zinc-500">{item.name}</span>
                <span className="text-[10px] text-zinc-300 ml-auto">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Orders Bar Chart + Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Orders Bar Chart */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShoppingBag size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Orders per Period</h2>
          </div>
          {analyticsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={20} className="animate-spin text-zinc-600" />
            </div>
          ) : analytics && analytics.revenue_trend.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.revenue_trend.slice(-14)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    tickFormatter={formatDate}
                    stroke="#27272a"
                  />
                  <YAxis 
                    tick={{ fontSize: 10, fill: '#71717a' }}
                    stroke="#27272a"
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#18181b', 
                      border: '1px solid #27272a',
                      borderRadius: '8px',
                      fontSize: '11px'
                    }}
                    labelFormatter={(label) => formatDate(label)}
                  />
                  <Bar dataKey="orders" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-zinc-600 text-xs">
              No order data available
            </div>
          )}
        </div>

        {/* Plan distribution */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Crown size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">User Plan Distribution</h2>
          </div>
          <div className="space-y-2.5">
            {Object.entries(stats.plan_distribution ?? {}).map(([plan, count]) => {
              const pct = stats.total_users > 0
                ? Math.round((count / stats.total_users) * 100)
                : 0;
              return (
                <div key={plan}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[plan] || "bg-zinc-700 text-zinc-300"}`}>
                      {plan}
                    </span>
                    <span className="text-xs text-zinc-400">{count} users <span className="text-zinc-600">({pct}%)</span></span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Customers & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Customers */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Crown size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Top Customers</h2>
          </div>
          {analyticsLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={20} className="animate-spin text-zinc-600" />
            </div>
          ) : analytics && analytics.top_customers.length > 0 ? (
            <div className="space-y-2">
              {analytics.top_customers.map((customer, index) => (
                <div key={customer.email} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400 font-medium">
                      {index + 1}
                    </div>
                    <div>
                      <p className="text-xs text-zinc-300 truncate max-w-[160px]">{customer.email}</p>
                      <p className="text-[10px] text-zinc-600 capitalize">{customer.plan} • {customer.orders} orders</p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-emerald-400">{customer.total_formatted}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-zinc-600 text-xs">
              No customer data
            </div>
          )}
        </div>

        {/* Processing status */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Event Processing Status</h2>
          </div>
          <div className="space-y-2">
            {Object.entries(stats.status_distribution ?? {}).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between py-1.5 border-b border-zinc-800 last:border-0">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    status === "completed"  ? "bg-emerald-400" :
                    status === "failed"     ? "bg-red-400"     :
                    status === "processing" ? "bg-blue-400"    :
                    status === "queued"     ? "bg-amber-400"   :
                    "bg-zinc-600"
                  }`} />
                  <span className={`text-xs capitalize ${STATUS_COLORS[status] || "text-zinc-500"}`}>
                    {status}
                  </span>
                </div>
                <span className="text-xs font-medium text-zinc-300">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      {analytics && analytics.recent_transactions.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Recent Transactions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-2 text-[10px] text-zinc-500 font-medium">Event</th>
                  <th className="text-left py-2 text-[10px] text-zinc-500 font-medium">User</th>
                  <th className="text-left py-2 text-[10px] text-zinc-500 font-medium">Amount</th>
                  <th className="text-left py-2 text-[10px] text-zinc-500 font-medium">Status</th>
                  <th className="text-left py-2 text-[10px] text-zinc-500 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {analytics.recent_transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-zinc-800/60">
                    <td className="py-2 text-zinc-300 truncate max-w-[140px]">{tx.event_name}</td>
                    <td className="py-2 text-zinc-500 truncate max-w-[130px]">{tx.user_email}</td>
                    <td className="py-2">
                      <span className={tx.status === "paid" ? "text-emerald-400" : "text-violet-400"}>
                        {tx.amount_formatted}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${
                        tx.status === "paid" 
                          ? "bg-emerald-500/15 text-emerald-400" 
                          : "bg-violet-500/15 text-violet-400"
                      }`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-2 text-zinc-500">
                      {tx.date ? new Date(tx.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tools */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 size={14} className="text-zinc-500" />
          <h2 className="text-xs font-semibold text-zinc-300">Quick Tools</h2>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleCleanup}
            disabled={cleaning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-300 transition-colors disabled:opacity-60"
          >
            {cleaning
              ? <Loader2 size={13} className="animate-spin" />
              : <Trash2 size={13} />
            }
            Run Expired Events Cleanup
          </button>
          {cleanMsg && (
            <span className="text-xs text-zinc-400">{cleanMsg}</span>
          )}
        </div>
      </div>
    </div>
  );
}