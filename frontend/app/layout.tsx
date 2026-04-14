import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import I18nProvider from '@/components/I18nProvider';

export const metadata: Metadata = {
  title: 'SpottedYou Translator — Vidéos X & YouTube en 21 langues',
  description: 'Traduisez et sous-titrez n\'importe quelle vidéo X ou YouTube en 21 langues avec l\'IA.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased bg-gray-950 text-white overflow-x-hidden">
        <I18nProvider>
          <Navbar />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
