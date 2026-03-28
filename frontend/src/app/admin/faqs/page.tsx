"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Edit2, Trash2, Save, Loader2, ArrowLeft, ChevronDown, ChevronUp
} from "lucide-react";
import Link from "next/link";

interface FAQ {
  id: number;
  question: string;
  answer: string;
  category: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080";

const CATEGORIES = [
  "Technology",
  "Performance", 
  "Security",
  "Guest Experience",
  "Technical",
  "Pricing",
  "Use Cases",
];

export default function AdminFAQsPage() {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [form, setForm] = useState({
    question: "",
    answer: "",
    category: "",
    sort_order: 0,
    is_active: true,
  });

  useEffect(() => {
    const t = localStorage.getItem("token");
    setToken(t);
    if (t) fetchFAQs(t);
  }, []);

  const fetchFAQs = async (authToken: string) => {
    try {
      const res = await fetch(`${API}/admin/cms/faqs`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFaqs(data);
      }
    } catch (e) {
      console.error("Failed to fetch FAQs", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!token || !form.question || !form.answer) return;
    setSaving(true);

    try {
      const url = editing
        ? `${API}/admin/cms/faqs/${editing}`
        : `${API}/admin/cms/faqs`;
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
        fetchFAQs(token);
        setShowForm(false);
        setEditing(null);
        setForm({
          question: "", answer: "", category: "", sort_order: 0, is_active: true,
        });
      }
    } catch (e) {
      console.error("Failed to save", e);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (f: FAQ) => {
    setEditing(f.id);
    setForm({
      question: f.question,
      answer: f.answer,
      category: f.category || "",
      sort_order: f.sort_order,
      is_active: f.is_active,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!token || !confirm("Delete this FAQ?")) return;

    try {
      await fetch(`${API}/admin/cms/faqs/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchFAQs(token);
    } catch (e) {
      console.error("Failed to delete", e);
    }
  };

  const handleToggleActive = async (f: FAQ) => {
    if (!token) return;

    try {
      await fetch(`${API}/admin/cms/faqs/${f.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_active: !f.is_active }),
      });
      fetchFAQs(token);
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
              <h1 className="text-2xl font-bold">FAQs</h1>
              <p className="text-gray-400 text-sm">
                Manage frequently asked questions
              </p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setEditing(null);
              setForm({
                question: "", answer: "", category: "", sort_order: 0, is_active: true,
              });
              setShowForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] rounded-lg font-medium"
          >
            <Plus size={18} />
            Add FAQ
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
                  {editing ? "Edit FAQ" : "New FAQ"}
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Question *</label>
                    <input
                      type="text"
                      value={form.question}
                      onChange={(e) => setForm({ ...form, question: e.target.value })}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none"
                      placeholder="What would users ask?"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Answer *</label>
                    <textarea
                      value={form.answer}
                      onChange={(e) => setForm({ ...form, answer: e.target.value })}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none resize-none"
                      rows={5}
                      placeholder="Provide a helpful answer"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-400 mb-1 block">Category</label>
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:border-[#6c63ff] outline-none"
                      >
                        <option value="" className="bg-[#111827]">No category</option>
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c} className="bg-[#111827]">{c}</option>
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
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="faq_active"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                      className="w-4 h-4 rounded border-white/20 bg-white/5"
                    />
                    <label htmlFor="faq_active" className="text-sm cursor-pointer">
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
                    disabled={saving || !form.question || !form.answer}
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

        {/* FAQs List */}
        <div className="space-y-3">
          {faqs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              No FAQs yet. Add your first one!
            </div>
          ) : (
            faqs.map((f) => (
              <motion.div
                key={f.id}
                layout
                className={`bg-[#111827] rounded-xl border ${
                  f.is_active ? "border-white/10" : "border-red-500/30 opacity-60"
                }`}
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                >
                  <div className="flex items-center gap-3 flex-1">
                    {f.category && (
                      <span className="text-[10px] font-mono text-[#3ecfcf] bg-[#3ecfcf]/10 px-2 py-0.5 rounded-full border border-[#3ecfcf]/20">
                        {f.category}
                      </span>
                    )}
                    <span className={`font-medium ${!f.is_active ? "text-gray-500" : ""}`}>
                      {f.question}
                    </span>
                    {!f.is_active && (
                      <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">
                        Hidden
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleToggleActive(f)}
                      className={`p-2 rounded-lg transition-colors ${
                        f.is_active
                          ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                          : "bg-gray-500/20 text-gray-400 hover:bg-gray-500/30"
                      }`}
                      title={f.is_active ? "Hide" : "Show"}
                    >
                      {f.is_active ? "✓" : "✕"}
                    </button>
                    <button
                      onClick={() => handleEdit(f)}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"
                    >
                      <Trash2 size={16} />
                    </button>
                    {expandedId === f.id ? (
                      <ChevronUp size={18} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={18} className="text-gray-400" />
                    )}
                  </div>
                </div>
                
                <AnimatePresence>
                  {expandedId === f.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-0 border-t border-white/5">
                        <p className="text-gray-400 text-sm mt-3 leading-relaxed">
                          {f.answer}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}