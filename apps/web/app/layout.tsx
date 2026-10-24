import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'RemoteAI - Cloud Dashboard',
  description: 'Control your local AI sessions remotely from Vercel 24/7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="dark">
      <body className="bg-[#0d1117] text-white antialiased">{children}</body>
    </html>
  );
}
