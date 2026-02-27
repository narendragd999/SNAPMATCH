"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * Drop this anywhere in your dashboard header/navbar.
 * It reads localStorage and only renders if role === "admin".
 *
 * Usage:
 *   import AdminBadge from "@/components/AdminBadge";
 *   <AdminBadge />
 */
export default function AdminBadge() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      setIsAdmin(user?.role === "admin");
    } catch {
      setIsAdmin(false);
    }
  }, []);

  if (!isAdmin) return null;

  return (
    <Link
      href="/admin"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-colors"
    >
      <ShieldCheck size={13} />
      <span className="text-[11px] font-medium">Admin Panel</span>
    </Link>
  );
}