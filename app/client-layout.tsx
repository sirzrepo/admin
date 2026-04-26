'use client';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { usePathname } from 'next/navigation';

function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname?.startsWith('/auth');

  return (
    <>
      {!isAuthPage && <Sidebar />}
      {!isAuthPage && <Header />}
      <main className={isAuthPage ? "" : "pl-20 pt-16 md:pl-64"}>
        {children}
      </main>
    </>
  );
}

export default LayoutContent;
