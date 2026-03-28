"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  CreditCard,
  IndianRupee,
  Trash2,
  LogOut,
  ShieldCheck,
  Menu,
  X,
  ChevronRight,
  Receipt,
  Activity,
  FileDown,
  MessageSquare,
  HelpCircle,
  Mail,
  Settings,
} from "lucide-react";

const NAV = [
  { href: "/admin",              label: "Dashboard",     icon: LayoutDashboard },
  { href: "/admin/users",        label: "Users",         icon: Users           },
  { href: "/admin/events",       label: "Events",        icon: CalendarDays    },
  { href: "/admin/orders",       label: "Orders",        icon: Receipt         },
  { href: "/admin/testimonials", label: "Testimonials",  icon: MessageSquare },
  { href: "/admin/faqs",         label: "FAQs",          icon: HelpCircle      },
  { href: "/admin/newsletter",   label: "Newsletter",    icon: Mail },
  { href: "/admin/activity-logs",label: "Activity Logs", icon: Activity        },
  { href: "/admin/plans",        label: "Plans",         icon: CreditCard      },
  { href: "/admin/pricing",      label: "Pricing",       icon: IndianRupee     },
  { href: "/admin/email-settings",label: "Email Settings",icon: Settings       },
  { href: "/admin/tools",        label: "Tools",         icon: Trash2          },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    const user  = JSON.parse(localStorage.getItem("user") || "{}");
    if (!token || user?.role !== "admin") {
      router.replace("/login");
      return;
    }
    setEmail(user.email || "");
  }, []);

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.replace("/login");
  };

  const Sidebar = ({ mobile = false }) => (
    <aside
      className={`${
        mobile
          ? "flex flex-col w-64 h-full"
          : "hidden lg:flex flex-col w-60 shrink-0"
      } bg-zinc-900 border-r border-zinc-800`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-zinc-800">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
          <ShieldCheck size={14} className="text-white" />
        </div>
        <span className="text-sm font-bold text-zinc-100">Admin Panel</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                active
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
              }`}
            >
              <Icon size={15} />
              {label}
              {active && <ChevronRight size={12} className="ml-auto text-zinc-600" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-zinc-800">
        <div className="px-3 py-2 mb-1">
          <p className="text-[10px] text-zinc-600">Signed in as</p>
          <p className="text-[11px] text-zinc-400 truncate">{email}</p>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-red-400 hover:bg-red-500/8 transition-colors"
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar mobile />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-zinc-800 flex items-center gap-3 px-4 shrink-0">
          <button
            className="lg:hidden text-zinc-500 hover:text-zinc-300"
            onClick={() => setOpen(true)}
          >
            <Menu size={18} />
          </button>
          <div className="flex-1" />
          <span className="text-[11px] text-zinc-600 bg-zinc-800/60 px-2.5 py-1 rounded-full">
            Superuser
          </span>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto p-5 lg:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}