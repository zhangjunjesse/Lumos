'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function BindPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [shareLink, setShareLink] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }

    fetch(`/api/bridge/feishu/callback?token=${token}`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.shareLink) {
          setShareLink(data.shareLink);
          setStatus('success');
          setTimeout(() => window.location.href = data.shareLink, 2000);
        } else {
          setStatus('error');
        }
      })
      .catch(() => setStatus('error'));
  }, [token]);

  if (status === 'loading') return <div className="p-8 text-center">正在创建飞书群组...</div>;
  if (status === 'error') return <div className="p-8 text-center text-red-500">绑定失败，请重试</div>;
  return (
    <div className="p-8 text-center">
      <p className="mb-4">群组创建成功！正在跳转...</p>
      <a href={shareLink} className="text-blue-500 underline">点击这里手动跳转</a>
    </div>
  );
}
