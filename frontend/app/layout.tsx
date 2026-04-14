import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'SpottedYou Translator',
  description: 'Traduisez vos vidéos X et YouTube',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
