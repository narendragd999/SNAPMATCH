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