"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Edit2, Trash2, Save, Loader2, Check, X, ArrowLeft
} from "lucide-react";
import Link from "next/link";

interface Testimonial {
  id: number;
  name: string;
  role: string;
  company: string | null;
  text: string;
  rating: number;
  avatar_url: string | null;
  verified: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080";

export default function AdminTestimonialsPage() {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    role: "",
    company: "",
    text: "",
    rating: 5,
    verified: false,
    sort_order: 0,
    is_active: true,
  });

  useEffect(() => {
    const t = localStorage.getItem("token");
    setToken(t);
    if (t) fetchTestimonials(t);
  }, []);

  const fetchTestimonials = async (authToken: string) => {
    try {
      const res = await fetch(`${API}/admin/cms/testimonials`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTestimonials(data);
      }
    } catch (e) {
      console.error("Failed to fetch testimonials", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!token || !form.name || !form.role || !form.text) return;
    setSaving(true);

    try {
      const url = editing
        ? `${API}/admin/cms/testimonials/${editing}`
        : `${API}/admin/cms/testimonials`;
      const method = editing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      if (res.ok) {
        fetchTestimonials(token);
        setShowForm(false);
        setEditing(null);
        setForm({
          name: "", role: "", company: "", text: "",
          rating: 5, verified: false, sort_order: 0, is_active: true,
        });
      }
    } catch (e) {
      console.error("Failed to save", e);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (t: Testimonial) => {
    setEditing(t.id);
    setForm({
      name: t.name,
      role: t.role,
      company: t.company || "",
      text: t.text,
      rating: t.rating,
      verified: t.verified,
      sort_order: t.sort_order,
      is_active: t.is_active,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!token || !confirm("Delete this testimonial?")) return;

    try {
      await fetch(`${API}/admin/cms/testimonials/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchTestimonials(token);
    } catch (e) {
      console.error("Failed to delete", e);
    }
  };

  const handleToggleActive = async (t: Testimonial) => {
    if (!token) return;

    try {
      await fetch(`${API}/admin/cms/testimonials/${t.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_active: !t.is_active }),
      });
      fetchTestimonials(token);
    } catch (e) {
      console.error("Failed to toggle", e);
    }
  };

  if (loading) {
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
              <h1 className="text-2xl font-bold">Testimonials</h1>
              <p className="text-gray-400 text-sm">
                Manage customer reviews for the landing page
              </p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setEditing(null);
              setForm({
                name: "", role: "", company: "", text: "",
                rating: 5, verified: false, sort_order: 0, is_active: true,
              });
              setShowForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] rounded-lg font-medium"
          >
            <Plus size={18} />
            Add Testimonial
          </motion.button>
        </div>

        {/* Form Modal */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowForm(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#111827] rounded-2xl p-6 w-full max-w-lg border border-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-xl font-bold mb-4">
                  {editing ? "Edit Testimonial" : "New Testimonial"}
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Name *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none"
                      placeholder="Customer name"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-400 mb-1 block">Role *</label>
                      <input
                        type="text"
                        value={form.role}
                        onChange={(e) => setForm({ ...form, role: e.target.value })}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none"
                        placeholder="e.g. Wedding Photographer"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-400 mb-1 block">Company</label>
                      <input
                        type="text"
                        value={form.company}
                        onChange={(e) => setForm({ ...form, company: e.target.value })}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none"
                        placeholder="Company name"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Testimonial *</label>
                    <textarea
                      value={form.text}
                      onChange={(e) => setForm({ ...form, text: e.target.value })}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none resize-none"
                      rows={4}
                      placeholder="What did they say about SnapFind?"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm text-gray-400 mb-1 block">Rating</label>
                      <select
                        value={form.rating}
                        onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none"
                      >
                        {[5, 4, 3, 2, 1].map((r) => (
                          <option key={r} value={r} className="bg-[#111827]">
                            {"★".repeat(r)}{"☆".repeat(5 - r)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm text-gray-400 mb-1 block">Sort Order</label>
                      <input
                        type="number"
                        value={form.sort_order}
                        onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none"
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.verified}
                          onChange={(e) => setForm({ ...form, verified: e.target.checked })}
                          className="w-4 h-4 rounded border-white/20 bg-white/5"
                        />
                        <span className="text-sm">Verified</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                      className="w-4 h-4 rounded border-white/20 bg-white/5"
                    />
                    <label htmlFor="is_active" className="text-sm cursor-pointer">
                      Active (show on landing page)
                    </label>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowForm(false)}
                    className="flex-1 px-4 py-2 border border-white/20 rounded-lg hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSave}
                    disabled={saving || !form.name || !form.role || !form.text}
                    className="flex-1 px-4 py-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={16} />}
                    {editing ? "Update" : "Create"}
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Testimonials List */}
        <div className="space-y-4">
          {testimonials.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              No testimonials yet. Add your first one!
            </div>
          ) : (
            testimonials.map((t) => (
              <motion.div
                key={t.id}
                layout
                className={`bg-[#111827] rounded-xl p-5 border ${
                  t.is_active ? "border-white/10" : "border-red-500/30 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{t.name}</span>
                      {t.verified && (
                        <Check size={16} className="text-emerald-400" />
                      )}
                      {!t.is_active && (
                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">
                          Hidden
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">
                      {t.role}
                      {t.company && ` · ${t.company}`}
                    </p>
                    <p className="text-gray-300 text-sm leading-relaxed mt-2">"{t.text}"</p>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleToggleActive(t)}
                      className={`p-2 rounded-lg transition-colors ${
                        t.is_active
                          ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                          : "bg-gray-500/20 text-gray-400 hover:bg-gray-500/30"
                      }`}
                      title={t.is_active ? "Hide" : "Show"}
                    >
                      {t.is_active ? <Check size={16} /> : <X size={16} />}
                    </button>
                    <button
                      onClick={() => handleEdit(t)}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}