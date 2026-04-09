"use client";

import { useEffect, useState } from "react";

interface Stats {
  totalUsers: number;
  todayUsers: number;
  totalRevenue: number;
  todayRevenue: number;
  totalOrders: number;
  todayImages: number;
}

const CARDS: { key: keyof Stats; label: string; fmt?: (v: number) => string }[] = [
  { key: "totalUsers", label: "总用户数" },
  { key: "todayUsers", label: "今日注册" },
  { key: "totalRevenue", label: "总收入", fmt: v => `¥${v.toFixed(2)}` },
  { key: "todayRevenue", label: "今日收入", fmt: v => `¥${v.toFixed(2)}` },
  { key: "totalOrders", label: "已付订单" },
  { key: "todayImages", label: "今日图片用量" },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then(r => r.json())
      .then(d => { if (d.success) setStats(d.data); });
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-neutral-800">仪表盘</h1>
      <div className="grid grid-cols-3 gap-4">
        {CARDS.map(c => (
          <div key={c.key} className="rounded-xl border bg-white px-5 py-4">
            <p className="text-xs text-neutral-400">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-800">
              {stats ? (c.fmt ? c.fmt(stats[c.key]) : stats[c.key]) : "-"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
