"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface OrderRow {
  id: string;
  user_email: string;
  user_nickname: string;
  plan_name: string;
  amount: number;
  pay_type: string;
  status: string;
  trade_no: string;
  paid_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  paid: { text: "已付款", cls: "bg-green-50 text-green-600" },
  pending: { text: "待支付", cls: "bg-yellow-50 text-yellow-600" },
  failed: { text: "失败", cls: "bg-red-50 text-red-500" },
  expired: { text: "已过期", cls: "bg-neutral-100 text-neutral-400" },
  refunded: { text: "已退款", cls: "bg-blue-50 text-blue-500" },
};

const FILTERS = [
  { value: "", label: "全部" },
  { value: "paid", label: "已付款" },
  { value: "pending", label: "待支付" },
  { value: "failed", label: "失败" },
];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), size: "20" });
    if (status) params.set("status", status);
    fetch(`/api/admin/orders?${params}`)
      .then(r => r.json())
      .then(d => { if (d.success) { setOrders(d.data.orders); setTotal(d.data.total); } });
  }, [page, status]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-800">订单管理</h1>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => { setStatus(f.value); setPage(1); }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition",
              status === f.value
                ? "bg-violet-100 font-medium text-violet-700"
                : "text-neutral-500 hover:bg-neutral-100",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="px-4 py-2.5">订单号</th>
              <th className="px-4 py-2.5">用户</th>
              <th className="px-4 py-2.5">套餐</th>
              <th className="px-4 py-2.5">金额</th>
              <th className="px-4 py-2.5">支付方式</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">时间</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => {
              const s = STATUS_LABEL[o.status] || { text: o.status, cls: "bg-neutral-100 text-neutral-400" };
              return (
                <tr key={o.id} className="border-b last:border-0 hover:bg-neutral-50/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">{o.id}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{o.user_nickname || "-"}</p>
                    <p className="text-xs text-neutral-400">{o.user_email}</p>
                  </td>
                  <td className="px-4 py-2.5">{o.plan_name}</td>
                  <td className="px-4 py-2.5 font-medium">¥{o.amount}</td>
                  <td className="px-4 py-2.5 text-neutral-600">
                    {o.pay_type === "alipay" ? "支付宝" : "微信"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px]", s.cls)}>{s.text}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-400">
                    {o.paid_at?.slice(0, 16) || o.created_at?.slice(0, 16)}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-400">暂无订单</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
          <span>共 {total} 条</span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="rounded border px-3 py-1 disabled:opacity-30"
            >
              上一页
            </button>
            <span className="px-2 py-1">{page}/{totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="rounded border px-3 py-1 disabled:opacity-30"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
