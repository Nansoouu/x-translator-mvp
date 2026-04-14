import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'SpottedYou Translator — Vidéos X & YouTube en 21 langues',
  description: 'Traduisez et sous-titrez n\'importe quelle vidéo X ou YouTube en 21 langues avec l\'IA.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-zinc-950 text-white antialiased">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
