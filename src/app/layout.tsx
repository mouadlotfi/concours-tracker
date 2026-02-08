import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Concours Developpement Web',
  description: 'Concours web/logiciel depuis wadifa-info.com (RSS + email)',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
