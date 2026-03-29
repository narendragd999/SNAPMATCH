"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Mail, Phone, Upload, Download, Send, 
  Plus, X, AlertCircle, Loader2, Trash2,
  Search, ChevronLeft, ChevronRight, MailCheck,
  Eye, ExternalLink, FileText, Check
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Guest {
  id: number;
  event_id: number;
  name: string | null;
  email: string;
  phone: string | null;
  notes: string | null;
  email_sent: boolean;
  email_sent_at: string | null;
  email_opened: boolean;
  visited_event: boolean;
  downloaded_photos: boolean;
  source: string;
  created_at: string;
}

interface GuestStats {
  total_guests: number;
  emails_sent: number;
  emails_opened: number;
  guests_visited: number;
  pending_notifications: number;
}

interface GuestResponse {
  event_id: number;
  guests: Guest[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  statistics: GuestStats;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface GuestManagementProps {
  eventId: string;
  eventName: string;
  publicToken: string;
  apiUrl: string;
  authToken: string;
  imageCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GuestManagement({
  eventId,
  eventName,
  publicToken,
  apiUrl,
  authToken,
  imageCount,
}: GuestManagementProps) {
  // State
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<GuestStats | null>(null);
  const [search, setSearch] = useState("");
  const [filterSent, setFilterSent] = useState<string>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedGuests, setSelectedGuests] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  // Add guest form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [adding, setAdding] = useState(false);

  // CSV import
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helpers
  const authH = () => ({ Authorization: `Bearer ${authToken}` });
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Load guests
  const loadGuests = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: "20",
      });
      if (search) params.append("search", search);
      if (filterSent === "sent") params.append("filter_sent", "true");
      if (filterSent === "pending") params.append("filter_sent", "false");

      const res = await fetch(`${apiUrl}/events/${eventId}/guests?${params}`, {
        headers: authH(),
      });
      if (!res.ok) throw new Error();
      const data: GuestResponse = await res.json();
      setGuests(data.guests);
      setTotalPages(data.pagination.total_pages);
      setTotal(data.pagination.total);
      setStats(data.statistics);
    } catch {
      showToast("Failed to load guests");
    } finally {
      setLoading(false);
    }
  }, [eventId, page, search, filterSent, apiUrl, authToken]);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Add guest
  const addGuest = async () => {
    if (!newEmail.trim()) {
      showToast("Email is required");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/guests`, {
        method: "POST",
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName || null,
          email: newEmail,
          phone: newPhone || null,
          notes: newNotes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to add guest");
      }
      showToast("✓ Guest added successfully");
      setShowAddModal(false);
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setNewNotes("");
      loadGuests();
    } catch (e: any) {
      showToast(e.message || "Failed to add guest");
    } finally {
      setAdding(false);
    }
  };

  // Delete guest
  const deleteGuest = async (guestId: number, guestEmail: string) => {
    if (!confirm(`Delete ${guestEmail}?`)) return;
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/guests/${guestId}`, {
        method: "DELETE",
        headers: authH(),
      });
      if (!res.ok) throw new Error();
      showToast("✓ Guest deleted");
      loadGuests();
    } catch {
      showToast("Failed to delete guest");
    }
  };

  // Bulk delete
  const bulkDelete = async () => {
    if (selectedGuests.size === 0) return;
    if (!confirm(`Delete ${selectedGuests.size} guest(s)?`)) return;
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/guests`, {
        method: "DELETE",
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify(Array.from(selectedGuests)),
      });
      if (!res.ok) throw new Error();
      showToast("✓ Guests deleted");
      setSelectedGuests(new Set());
      loadGuests();
    } catch {
      showToast("Failed to delete guests");
    }
  };

  // Send notifications
  const sendNotifications = async (guestIds?: number[]) => {
    setSending(true);
    try {
      const eventUrl = `${window.location.origin}/public/${publicToken}`;
      const res = await fetch(`${apiUrl}/events/${eventId}/guests/send-notifications`, {
        method: "POST",
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({
          guest_ids: guestIds,
          photo_count: imageCount,
          event_url: eventUrl,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      showToast(`✓ ${data.sent_count} notification(s) sent`);
      setSelectedGuests(new Set());
      loadGuests();
    } catch {
      showToast("Failed to send notifications");
    } finally {
      setSending(false);
    }
  };

  // Import CSV
  const importCSV = async () => {
    if (!csvFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      const res = await fetch(`${apiUrl}/events/${eventId}/guests/import-csv`, {
        method: "POST",
        headers: authH(),
        body: formData,
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setImportResult({ imported: data.imported_count, failed: data.failed_count });
      if (data.imported_count > 0) {
        showToast(`✓ ${data.imported_count} guests imported`);
        loadGuests();
      }
    } catch {
      showToast("Failed to import CSV");
    } finally {
      setImporting(false);
    }
  };

  // Export CSV
  const exportCSV = async () => {
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/guests/export-csv`, {
        headers: authH(),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${eventName.replace(/[^a-z0-9]/gi, '_')}_guests.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast("Failed to export CSV");
    }
  };

  // Toggle selection
  const toggleSelect = (id: number) => {
    const next = new Set(selectedGuests);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedGuests(next);
  };

  const selectAll = () => {
    if (selectedGuests.size === guests.length) {
      setSelectedGuests(new Set());
    } else {
      setSelectedGuests(new Set(guests.map(g => g.id)));
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -10, x: "-50%" }}
            className="fixed top-20 left-1/2 z-[999] bg-zinc-800 border border-zinc-700 text-xs font-medium px-4 py-2.5 rounded-xl shadow-xl whitespace-nowrap"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total Guests", value: stats.total_guests, icon: Users, color: "blue" },
            { label: "Emails Sent", value: stats.emails_sent, icon: Mail, color: "emerald" },
            { label: "Opened", value: stats.emails_opened, icon: Eye, color: "violet" },
            { label: "Visited", value: stats.guests_visited, icon: ExternalLink, color: "amber" },
            { label: "Pending", value: stats.pending_notifications, icon: AlertCircle, color: "orange" },
          ].map((stat) => (
            <div key={stat.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${
                stat.color === "blue" ? "bg-blue-500/10 text-blue-400" :
                stat.color === "emerald" ? "bg-emerald-500/10 text-emerald-400" :
                stat.color === "violet" ? "bg-violet-500/10 text-violet-400" :
                stat.color === "amber" ? "bg-amber-500/10 text-amber-400" :
                "bg-orange-500/10 text-orange-400"
              }`}>
                <stat.icon size={14} />
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search guests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-700"
          />
        </div>

        {/* Filter */}
        <select
          value={filterSent}
          onChange={(e) => { setFilterSent(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-700"
        >
          <option value="all">All Guests</option>
          <option value="pending">Pending</option>
          <option value="sent">Notified</option>
        </select>

        {/* Add Guest Button */}
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={14} />
          Add Guest
        </button>

        {/* Import Button */}
        <button
          onClick={() => setShowImportModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-lg transition-colors border border-zinc-700"
        >
          <Upload size={14} />
          Import
        </button>

        {/* Export Button */}
        <button
          onClick={exportCSV}
          disabled={total === 0}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-lg transition-colors border border-zinc-700 disabled:opacity-50"
        >
          <Download size={14} />
          Export
        </button>

        {/* Bulk Actions */}
        {selectedGuests.size > 0 && (
          <>
            <button
              onClick={() => sendNotifications(Array.from(selectedGuests))}
              disabled={sending}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Notify ({selectedGuests.size})
            </button>
            <button
              onClick={bulkDelete}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium rounded-lg transition-colors border border-red-600/30"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </>
        )}
      </div>

      {/* Guest List */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-zinc-500" />
          </div>
        ) : guests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <Users size={32} className="mb-3 opacity-50" />
            <p className="text-sm">No guests yet</p>
            <p className="text-xs mt-1">Add guests to notify them when photos are ready</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm rounded-lg transition-colors"
            >
              Add First Guest
            </button>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-zinc-800/50 border-b border-zinc-800 text-xs font-medium text-zinc-400">
              <div className="col-span-1 flex items-center">
                <input
                  type="checkbox"
                  checked={selectedGuests.size === guests.length && guests.length > 0}
                  onChange={selectAll}
                  className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-3">Guest</div>
              <div className="col-span-3">Contact</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Added</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>

            {/* Table Body */}
            {guests.map((guest) => (
              <div
                key={guest.id}
                className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/30 text-sm"
              >
                <div className="col-span-1 flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedGuests.has(guest.id)}
                    onChange={() => toggleSelect(guest.id)}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-3 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 text-xs font-medium flex-shrink-0">
                    {guest.name?.[0]?.toUpperCase() || guest.email[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{guest.name || "—"}</p>
                    <p className="text-xs text-zinc-500 truncate">{guest.email}</p>
                  </div>
                </div>
                <div className="col-span-3 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-zinc-400">
                    <Mail size={11} />
                    <span className="truncate text-xs">{guest.email}</span>
                  </div>
                  {guest.phone && (
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Phone size={11} />
                      <span className="text-xs">{guest.phone}</span>
                    </div>
                  )}
                </div>
                <div className="col-span-2 flex items-center gap-1.5 flex-wrap">
                  {guest.email_sent ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium">
                      <Check size={10} />
                      Sent
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400 text-[10px] font-medium">
                      Pending
                    </span>
                  )}
                  {guest.email_opened && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 text-[10px] font-medium">
                      <Eye size={10} />
                      Opened
                    </span>
                  )}
                </div>
                <div className="col-span-2 flex items-center text-xs text-zinc-500">
                  {formatDate(guest.created_at)}
                  <span className="text-zinc-600 ml-1 text-[10px]">via {guest.source}</span>
                </div>
                <div className="col-span-1 flex items-center justify-end gap-1">
                  {!guest.email_sent && (
                    <button
                      onClick={() => sendNotifications([guest.id])}
                      disabled={sending}
                      className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-emerald-400 transition-colors"
                      title="Send notification"
                    >
                      <Send size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteGuest(guest.id, guest.email)}
                    className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                <p className="text-xs text-zinc-500">
                  {total} guest{total !== 1 ? "s" : ""}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-zinc-400">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Send All Button */}
      {stats && stats.pending_notifications > 0 && (
        <div className="flex items-center justify-center">
          <button
            onClick={() => sendNotifications()}
            disabled={sending}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white font-medium rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20"
          >
            {sending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <MailCheck size={16} />
                Notify All Guests ({stats.pending_notifications})
              </>
            )}
          </button>
        </div>
      )}

      {/* Add Guest Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
            onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <h3 className="font-semibold">Add Guest</h3>
                <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name (optional)</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email *</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="john@example.com"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Phone (optional)</label>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+1 234 567 8900"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Notes (optional)</label>
                  <textarea
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="VIP, family member, etc."
                    rows={2}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-600 resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 px-5 py-4 border-t border-zinc-800">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-lg border border-zinc-700 text-sm font-medium hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addGuest}
                  disabled={adding || !newEmail.trim()}
                  className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {adding ? "Adding..." : "Add Guest"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import CSV Modal */}
      <AnimatePresence>
        {showImportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
            onClick={(e) => e.target === e.currentTarget && setShowImportModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <h3 className="font-semibold">Import Guests from CSV</h3>
                <button onClick={() => setShowImportModal(false)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="text-sm text-zinc-400">
                  <p className="mb-2 font-medium">CSV format:</p>
                  <code className="block bg-zinc-800 px-3 py-2 rounded-lg text-xs font-mono text-zinc-300">
                    name,email,phone,notes<br />
                    John,john@example.com,+1234,VIP
                  </code>
                </div>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-700 rounded-xl p-6 text-center cursor-pointer hover:border-zinc-600 transition-colors"
                >
                  <FileText size={24} className="mx-auto text-zinc-500 mb-2" />
                  <p className="text-sm text-zinc-300">
                    {csvFile ? csvFile.name : "Click to select CSV file"}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">Supports .csv files</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                {importResult && (
                  <div className="flex gap-4 text-sm p-3 bg-zinc-800 rounded-lg">
                    <span className="text-emerald-400">✓ {importResult.imported} imported</span>
                    {importResult.failed > 0 && (
                      <span className="text-orange-400">⚠ {importResult.failed} skipped</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-3 px-5 py-4 border-t border-zinc-800">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setCsvFile(null);
                    setImportResult(null);
                  }}
                  className="flex-1 py-2.5 rounded-lg border border-zinc-700 text-sm font-medium hover:bg-zinc-800 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={importCSV}
                  disabled={importing || !csvFile}
                  className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {importing ? "Importing..." : "Import"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}