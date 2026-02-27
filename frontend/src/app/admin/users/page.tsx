"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getAdminUsers,
  deleteAdminUser,
  updateAdminUser,
  createAdminUser,
} from "@/services/adminApi";
import {
  Search,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";

type User = {
  id: number;
  email: string;
  role: string;
  plan_type: string;
  event_count: number;
  created_at: string;
};

type UserList = {
  users: User[];
  total: number;
  page: number;
  total_pages: number;
};

const PLAN_BADGE: Record<string, string> = {
  free:       "bg-zinc-700/60 text-zinc-400",
  pro:        "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  enterprise: "bg-violet-500/15 text-violet-400 border border-violet-500/20",
};

// ─── Modal ───────────────────────────────────────────────────────────
function UserModal({
  user,
  onClose,
  onSave,
}: {
  user: User | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const isEdit = !!user;
  const [email,     setEmail]    = useState(user?.email    || "");
  const [plan,      setPlan]     = useState(user?.plan_type || "free");
  const [role,      setRole]     = useState(user?.role      || "owner");
  const [password,  setPassword] = useState("");
  const [saving,    setSaving]   = useState(false);
  const [error,     setError]    = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        const patch: Record<string, string> = { plan_type: plan, role };
        if (email !== user!.email) patch.email = email;
        if (password)              patch.password = password;
        await updateAdminUser(user!.id, patch);
      } else {
        if (!password) { setError("Password required"); setSaving(false); return; }
        await createAdminUser({ email, password, plan_type: plan, role });
      }
      onSave();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">
            {isEdit ? "Edit User" : "Create User"}
          </h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Email */}
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1.5">Email</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700"
            />
          </div>

          {/* Plan */}
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1.5">Plan</label>
            <select
              value={plan}
              onChange={e => setPlan(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          {/* Role */}
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1.5">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200"
            >
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {/* Password */}
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1.5">
              {isEdit ? "New Password (leave blank to keep)" : "Password"}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700"
            />
          </div>

          {error && (
            <p className="text-[11px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-2 px-6 pb-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-zinc-800 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors disabled:opacity-60"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {isEdit ? "Save Changes" : "Create User"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Page ─────────────────────────────────────────────────────────────
export default function AdminUsersPage() {
  const [data,     setData]     = useState<UserList | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [plan,     setPlan]     = useState("");
  const [page,     setPage]     = useState(1);
  const [modal,    setModal]    = useState<User | null | "new">(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirm,  setConfirm]  = useState<User | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAdminUsers({ page, limit: 20, search, plan })
      .then(setData)
      .finally(() => setLoading(false));
  }, [page, search, plan]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 on filter change
  useEffect(() => { setPage(1); }, [search, plan]);

  const handleDelete = async (user: User) => {
    setDeleting(user.id);
    try {
      await deleteAdminUser(user.id);
      load();
    } finally {
      setDeleting(null);
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Users</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            {data ? `${data.total} total users` : "Loading…"}
          </p>
        </div>
        <button
          onClick={() => setModal("new")}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
        >
          <Plus size={13} />
          New User
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-zinc-700 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-700"
          />
        </div>
        <select
          value={plan}
          onChange={e => setPlan(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 focus:outline-none"
        >
          <option value="">All Plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
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
                  {["Email", "Role", "Plan", "Events", "Joined", "Actions"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-medium text-zinc-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.users.map(user => (
                  <tr key={user.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                          {user.role === "admin"
                            ? <ShieldCheck size={11} className="text-violet-400" />
                            : <UserIcon    size={11} className="text-zinc-500"    />
                          }
                        </div>
                        <span className="text-zinc-300 truncate max-w-[180px]">{user.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-medium capitalize px-2 py-0.5 rounded-full ${
                        user.role === "admin"
                          ? "bg-violet-500/15 text-violet-400 border border-violet-500/20"
                          : "bg-zinc-800 text-zinc-500"
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-medium capitalize px-2 py-0.5 rounded-full ${PLAN_BADGE[user.plan_type] || ""}`}>
                        {user.plan_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{user.event_count}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setModal(user)}
                          className="text-zinc-600 hover:text-zinc-300 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => setConfirm(user)}
                          className="text-zinc-600 hover:text-red-400 transition-colors"
                        >
                          {deleting === user.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Trash2   size={13} />
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!data?.users.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-xs text-zinc-600">
                      No users found
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
                className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-500 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= data.total_pages}
                className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-500 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit / Create modal */}
      {modal !== null && (
        <UserModal
          user={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSave={load}
        />
      )}

      {/* Delete confirm */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-100">Delete User?</h2>
            <p className="text-xs text-zinc-500 leading-relaxed">
              This will permanently delete <span className="text-zinc-300">{confirm.email}</span> and all
              their events, images, and face data. This cannot be undone.
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
                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}