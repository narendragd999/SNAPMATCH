"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  LayoutDashboard,
  Folder,
  LogOut,
  Crown,
  ChevronLeft,
  ChevronRight,
  Scan,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";
import { useAuth } from "@/context/AuthContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Events",    href: "/events",    icon: Folder },
  ];

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const pageTitle = pathname.split("/").filter(Boolean)[0] || "dashboard";

  // Avatar initials
  const initials = user
    ? (user.name?.charAt(0) || user.email?.charAt(0) || "U").toUpperCase()
    : "U";

  const planLabel = (user?.plan_type || "free").toUpperCase();

  return (
    <ProtectedRoute>
      <div className="flex h-screen bg-zinc-950 text-zinc-100 antialiased overflow-hidden">

        {/* ── SIDEBAR ── */}
        <aside className={`relative flex flex-col h-full border-r border-zinc-800/60 bg-zinc-950 transition-all duration-300 ease-in-out flex-shrink-0 ${
          collapsed ? "w-[60px]" : "w-56"
        }`}>

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="absolute -right-3 top-5 z-10 w-6 h-6 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition-colors shadow-lg"
          >
            {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
          </button>

          {/* Logo */}
          <div className={`flex items-center gap-2.5 h-12 border-b border-zinc-800/60 flex-shrink-0 ${
            collapsed ? "px-3.5 justify-center" : "px-4"
          }`}>
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <Scan size={12} className="text-white" />
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight text-zinc-100 truncate">
                {APP_CONFIG.name}
              </span>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
            {navItems.map(item => {
              const Icon     = item.icon;
              const isActive = pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.name : undefined}
                  className={`flex items-center gap-2.5 rounded-lg text-xs font-medium transition-colors ${
                    collapsed ? "px-0 justify-center h-9 w-9 mx-auto" : "px-3 py-2"
                  } ${
                    isActive
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <Icon size={14} className={isActive ? "text-blue-400" : ""} />
                  {!collapsed && item.name}
                </Link>
              );
            })}
          </nav>

          {/* Bottom */}
          <div className={`border-t border-zinc-800/60 flex-shrink-0 ${collapsed ? "py-3 px-2 space-y-2" : "p-3 space-y-1"}`}>

            {/* Plan badge — only expanded */}
            {!collapsed && user && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <Crown size={11} className="text-amber-400 flex-shrink-0" />
                <span className="text-[10px] font-semibold text-amber-400 tracking-wider">{planLabel}</span>
              </div>
            )}

            {/* User row */}
            {!collapsed && user ? (
              <div className="flex items-center gap-2.5 px-3 py-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-200 truncate leading-tight">
                    {user.name || user.email?.split("@")[0]}
                  </p>
                  <p className="text-[10px] text-zinc-600 truncate leading-tight mt-0.5">
                    {user.email}
                  </p>
                </div>
              </div>
            ) : collapsed && user ? (
              /* Collapsed avatar */
              <div className="flex justify-center">
                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-bold">
                  {initials}
                </div>
              </div>
            ) : null}

            {/* Logout */}
            <button
              onClick={handleLogout}
              title={collapsed ? "Logout" : undefined}
              className={`flex items-center gap-2 text-xs text-zinc-600 hover:text-red-400 hover:bg-red-500/8 rounded-lg transition-colors w-full ${
                collapsed ? "justify-center h-9 w-9 mx-auto px-0" : "px-3 py-2"
              }`}
            >
              <LogOut size={13} />
              {!collapsed && "Logout"}
            </button>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">

          {/* Top bar */}
          <header className="h-12 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur flex items-center px-6 justify-between flex-shrink-0">
            <h2 className="text-sm font-semibold text-zinc-300 capitalize tracking-tight">
              {pageTitle}
            </h2>

            {/* Right side — plan pill on mobile / small screens */}
            {user && (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-500/8 border border-amber-500/15 px-2 py-1 rounded-md">
                  <Crown size={9} />
                  {planLabel}
                </span>
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-bold sm:hidden">
                  {initials}
                </div>
              </div>
            )}
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-6 py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}