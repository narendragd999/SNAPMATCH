"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import API from "@/services/api";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ImagePlus, ArrowLeft, AlertCircle, X } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

export default function CreateEventPage() {
  const router = useRouter();

  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [coverImage,  setCoverImage]  = useState<File | null>(null);
  const [preview,     setPreview]     = useState<string | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [dragOver,    setDragOver]    = useState(false);

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", description);
      if (coverImage) formData.append("cover_image", coverImage);

      await API.post("/events/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      router.push("/events");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to create event");
    } finally {
      setLoading(false);
    }
  };

  // ─── File handling ─────────────────────────────────────────────────────────
  const handleFileChange = (file: File | null) => {
    if (!file) return;
    setCoverImage(file);
    setPreview(URL.createObjectURL(file));
  };

  const clearCover = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCoverImage(null);
    setPreview(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) handleFileChange(file);
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">

        {/* ── HEADER ── */}
        <div>
          <Link
            href="/events"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-4 group"
          >
            <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" />
            Back to Events
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-zinc-50">Create Event</h1>
          <p className="text-xs text-zinc-500 mt-1">Start indexing photos with AI instantly</p>
        </div>

        {/* ── FORM CARD ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden max-w-xl"
        >
          <form onSubmit={handleCreate}>

            {/* Form body */}
            <div className="p-6 space-y-5">

              {/* Event Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">
                  Event Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Wedding 2026"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 outline-none rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">
                  Description{" "}
                  <span className="text-zinc-600 font-normal">(optional)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Brief event description…"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 outline-none rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors resize-none"
                />
              </div>

              {/* Cover Image */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">
                  Cover Image{" "}
                  <span className="text-zinc-600 font-normal">(optional)</span>
                </label>

                <div
                  className={`relative rounded-xl border border-dashed cursor-pointer transition-colors overflow-hidden ${
                    dragOver
                      ? "border-blue-500/50 bg-blue-500/5"
                      : preview
                      ? "border-zinc-700"
                      : "border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/40"
                  }`}
                  onClick={() => document.getElementById("coverInput")?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  {preview ? (
                    <>
                      <img
                        src={preview}
                        alt="Cover preview"
                        className="w-full h-44 object-cover block"
                      />
                      {/* Clear button */}
                      <button
                        type="button"
                        onClick={clearCover}
                        className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-lg bg-black/60 border border-white/10 text-white hover:bg-black/80 transition-colors"
                      >
                        <X size={13} />
                      </button>
                      {/* Replace hint */}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-4 py-3">
                        <p className="text-[11px] text-white/50">Click or drop to replace</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2.5 py-10 px-6">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${
                        dragOver
                          ? "bg-blue-500/20 border-blue-500/30 text-blue-400"
                          : "bg-zinc-800 border-zinc-700 text-zinc-500"
                      }`}>
                        <ImagePlus size={16} />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-medium text-zinc-400">Drop image here</p>
                        <p className="text-[11px] text-zinc-600 mt-0.5">or click to browse · JPG, PNG, WEBP</p>
                      </div>
                    </div>
                  )}
                </div>

                <input
                  id="coverInput"
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={e => handleFileChange(e.target.files?.[0] || null)}
                />
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex items-start gap-2.5 bg-red-500/8 border border-red-500/20 rounded-xl px-3.5 py-3"
                  >
                    <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400 leading-relaxed">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── FOOTER ACTIONS ── */}
            <div className="px-6 py-4 border-t border-zinc-800 flex gap-2">
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create Event"
                )}
              </button>

              <Link
                href="/events"
                className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
              >
                Cancel
              </Link>
            </div>

          </form>
        </motion.div>

      </div>
    </ProtectedRoute>
  );
}