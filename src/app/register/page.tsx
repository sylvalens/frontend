'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          displayName: displayName || undefined,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Registration failed (${res.status}): ${text || res.statusText}`,
        );
      }

      router.push('/map');
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'Registration failed';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: '#f3f4f6',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 340,
          padding: 24,
          borderRadius: 8,
          background: '#ffffff',
          boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>Create account</h1>
        <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
          Already registered? <Link href="/login">Go to login</Link>.
        </p>

        <label style={{ fontSize: 13 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              fontSize: 13,
            }}
          />
        </label>

        <label style={{ fontSize: 13 }}>
          Password (min 8 chars)
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={{
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              fontSize: 13,
            }}
          />
        </label>

        <label style={{ fontSize: 13 }}>
          Display name (optional)
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              fontSize: 13,
            }}
          />
        </label>

        {error && (
          <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 8,
            padding: '6px 10px',
            borderRadius: 4,
            border: 'none',
            backgroundColor: '#16a34a',
            color: 'white',
            fontSize: 14,
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Creating account...' : 'Register'}
        </button>
      </form>
    </div>
  );
}
