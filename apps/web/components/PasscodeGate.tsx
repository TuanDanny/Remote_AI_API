'use client';
import React, { useState, useEffect } from 'react';

export function PasscodeGate({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const targetPin = process.env.NEXT_PUBLIC_DASHBOARD_PIN || '123456';

  useEffect(() => {
    const saved = localStorage.getItem('remote_ai_pin');
    if (saved === targetPin) {
      setAuthorized(true);
    } else {
      setAuthorized(false);
    }
  }, [targetPin]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === targetPin) {
      localStorage.setItem('remote_ai_pin', pin);
      setAuthorized(true);
      setError('');
    } else {
      setError('Mã PIN không chính xác!');
    }
  };

  if (authorized === null) return null;

  if (!authorized) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0d1117] text-white">
        <form onSubmit={handleSubmit} className="w-80 rounded-xl border border-[#30363d] bg-[#161b22] p-6 shadow-2xl">
          <h2 className="mb-2 text-xl font-bold text-center">RemoteAI Access</h2>
          <p className="mb-4 text-xs text-center text-gray-400">Nhập mã PIN bảo vệ để mở dashboard</p>
          <input
            type="password"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Mã PIN (VD: 123456)"
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 text-center text-lg tracking-widest text-white outline-none focus:border-[#58a6ff]"
          />
          {error && <p className="mt-2 text-xs text-red-400 text-center">{error}</p>}
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-[#238636] py-2.5 font-medium hover:bg-[#2ea043] transition"
          >
            Mở Dashboard
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
