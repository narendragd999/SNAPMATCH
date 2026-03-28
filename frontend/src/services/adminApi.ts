import API from "@/services/api";
import { invalidatePricingConfig } from "@/lib/pricing";

// ─── Stats ───────────────────────────────────────────────
export const getAdminStats = () =>
  API.get("/admin/stats").then((r) => r.data);

// ─── Users ───────────────────────────────────────────────
export const getAdminUsers = (params: {
  page?: number;
  limit?: number;
  search?: string;
  plan?: string;
}) => API.get("/admin/users", { params }).then((r) => r.data);

export const getAdminUser = (id: number) =>
  API.get(`/admin/users/${id}`).then((r) => r.data);

export const createAdminUser = (data: {
  email: string;
  password: string;
  plan_type: string;
  role: string;
}) => API.post("/admin/users", data).then((r) => r.data);

export const updateAdminUser = (
  id: number,
  data: {
    email?: string;
    plan_type?: string;
    role?: string;
    password?: string;
  }
) => API.patch(`/admin/users/${id}`, data).then((r) => r.data);

export const deleteAdminUser = (id: number) =>
  API.delete(`/admin/users/${id}`).then((r) => r.data);

// ─── Events ──────────────────────────────────────────────
export const getAdminEvents = (params: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}) => API.get("/admin/events", { params }).then((r) => r.data);

export const deleteAdminEvent = (id: number) =>
  API.delete(`/admin/events/${id}`).then((r) => r.data);

// ─── Plans ───────────────────────────────────────────────
export const getAdminPlans = () =>
  API.get("/admin/plans").then((r) => r.data);

// ─── Cleanup ─────────────────────────────────────────────
export const triggerCleanup = () =>
  API.post("/admin/cleanup").then((r) => r.data);

// ─── Pricing Config ───────────────────────────────────────
export const getAdminPricingConfig = () =>
  API.get("/pricing/config").then((r) => r.data);

export const updateAdminPricingConfig = async (data: Record<string, unknown>) => {
  const result = await API.put("/pricing/config", data).then((r) => r.data);
  // Bust the frontend module-scope cache so the next getPricingConfig()
  // call fetches the new values from the server.
  invalidatePricingConfig();
  return result;
};

export const getAdminPricingHistory = () =>
  API.get("/pricing/config/history").then((r) => r.data);

// ─── Orders ───────────────────────────────────────────────
export const getAdminOrders = (params: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  order_type?: string;
}) => API.get("/admin/orders", { params }).then((r) => r.data);

export const getAdminOrder = (id: number) =>
  API.get(`/admin/orders/${id}`).then((r) => r.data);

export const getAdminOrdersStats = () =>
  API.get("/admin/orders/stats").then((r) => r.data);

export const getAdminRevenueAnalytics = (period: string = "30d") =>
  API.get("/admin/orders/analytics", { params: { period } }).then((r) => r.data);

// ─── Event Analytics ───────────────────────────────────────
export const getEventAnalytics = (eventId: number, days: number = 30) =>
  API.get(`/analytics/event/${eventId}`, { params: { days } }).then((r) => r.data);

export const trackEventActivity = (eventId: number, activityType: string) =>
  API.post(`/analytics/event/${eventId}/track`, null, { params: { activity_type: activityType } }).then((r) => r.data);

// ─── Activity Logs ──────────────────────────────────────────
export const getActivityLogs = (params: {
  page?: number;
  limit?: number;
  user_id?: number;
  activity_type?: string;
  status?: string;
  search?: string;
}) => API.get("/admin/activity-logs", { params }).then((r) => r.data);

export const getActivityStats = (days: number = 7) =>
  API.get("/admin/activity-logs/stats", { params: { days } }).then((r) => r.data);

// ─── Export Reports ──────────────────────────────────────────
export const exportData = (
  exportType: string,
  format: string = "csv",
  startDate?: string,
  endDate?: string
) => {
  const params: Record<string, string> = { format };
  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;
  return API.get(`/admin/export/${exportType}`, { 
    params, 
    responseType: format === "csv" ? "blob" : "json" 
  }).then((r) => r.data);
};

export const getExportUrl = (
  exportType: string,
  format: string = "csv",
  startDate?: string,
  endDate?: string
) => {
  const baseUrl = API.defaults.baseURL || "";
  const params = new URLSearchParams({ format });
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return `${baseUrl}/admin/export/${exportType}?${params.toString()}&token=${token}`;
};