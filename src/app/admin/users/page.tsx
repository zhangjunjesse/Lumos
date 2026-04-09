"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface UserRow {
  id: string;
  email: string;
  nickname: string;
  role: string;
  membership: string;
  image_quota_monthly: number;
  status: string;
  last_login_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = { active: "正常", disabled: "禁用", deleted: "已删除" };
const MEMBERSHIP_LABEL: Record<string, string> = { free: "免费", monthly: "月卡", yearly: "年卡" };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), size: "20" });
    if (search) params.set("q", search);
    fetch(`/api/admin/users?${params}`)
      .then(r => r.json())
      .then(d => { if (d.success) { setUsers(d.data.users); setTotal(d.data.total); } });
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = async (u: UserRow) => {
    const newStatus = u.status === "active" ? "disabled" : "active";
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: u.id, status: newStatus }),
    });
    load();
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-800">用户管理</h1>

      {/* Search */}
      <form
        onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query); }}
        className="mb-4 flex gap-2"
      >
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索邮箱或昵称..."
          className="h-9 w-64 rounded-lg border px-3 text-sm outline-none focus:border-violet-300"
        />
        <button
          type="submit"
          className="h-9 rounded-lg bg-neutral-800 px-4 text-sm text-white hover:bg-neutral-700"
        >
          搜索
        </button>
      </form>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="px-4 py-2.5">用户</th>
              <th className="px-4 py-2.5">角色</th>
              <th className="px-4 py-2.5">会员</th>
              <th className="px-4 py-2.5">图片额度</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">注册时间</th>
              <th className="px-4 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-neutral-50/50">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{u.nickname || "-"}</p>
                  <p className="text-xs text-neutral-400">{u.email}</p>
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[11px]",
                    u.role === "admin" ? "bg-violet-100 text-violet-700" : "bg-neutral-100 text-neutral-500",
                  )}>
                    {u.role === "admin" ? "管理员" : "用户"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{MEMBERSHIP_LABEL[u.membership] || u.membership}</td>
                <td className="px-4 py-2.5 text-neutral-600">{u.image_quota_monthly}</td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[11px]",
                    u.status === "active" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500",
                  )}>
                    {STATUS_LABEL[u.status] || u.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-neutral-400 text-xs">{u.created_at?.slice(0, 10)}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => toggleStatus(u)}
                    className={cn(
                      "rounded px-2 py-1 text-xs transition",
                      u.status === "active"
                        ? "text-red-500 hover:bg-red-50"
                        : "text-green-600 hover:bg-green-50",
                    )}
                  >
                    {u.status === "active" ? "禁用" : "启用"}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-400">暂无用户</td></tr>
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
