"use client";

import { useProAuth } from "@/hooks/useProAuth";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/admin", label: "仪表盘" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/orders", label: "订单管理" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useProAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/chat");
    }
  }, [user, router]);

  if (!user || user.role !== "admin") return null;

  return (
    <div className="flex h-full min-h-screen bg-neutral-50">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r bg-white px-3 py-6">
        <h2 className="mb-5 px-2 text-sm font-semibold text-neutral-800">管理后台</h2>
        <nav className="space-y-0.5">
          {NAV_ITEMS.map(item => {
            const active = item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block rounded-md px-2 py-1.5 text-sm transition",
                  active
                    ? "bg-violet-50 font-medium text-violet-700"
                    : "text-neutral-600 hover:bg-neutral-100",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-8 border-t pt-4 px-2">
          <Link
            href="/chat"
            className="text-xs text-neutral-400 hover:text-neutral-600 transition"
          >
            &larr; 返回工作台
          </Link>
        </div>
      </aside>
      {/* Main content */}
      <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
    </div>
  );
}
