'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'ok' | 'down';

export default function Home() {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const base =
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      process.env.API_BASE_URL ||
      'http://localhost:4000';

    fetch(`${base}/health`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('API not OK');
        return res.json();
      })
      .then(() => setStatus('ok'))
      .catch(() => setStatus('down'));
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Forest BD Viewer</h1>
      <p>Backend status: <strong>{
        status === 'checking'
          ? 'Checking…'
          : status === 'ok'
          ? '✅ OK'
          : '❌ Down'
      }</strong></p>

      <p>
        <Link href="/map">Open forest map</Link>
      </p>
    </main>
  );
}
