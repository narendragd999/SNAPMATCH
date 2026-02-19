"use client";

import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (!loading && !token && !redirected.current) {
      redirected.current = true;
      router.replace("/login"); // 🔥 replace instead of push
    }
  }, [token, loading, router]);

  // While checking auth state
  if (loading) return null;

  // If no token, don't render page content
  if (!token) return null;

  return <>{children}</>;
}
