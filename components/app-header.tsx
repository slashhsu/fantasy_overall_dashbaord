"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ListOrdered, LogOut, Trophy } from "lucide-react";

export function AppHeader({ demoMode = false }: { demoMode?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand-lockup">
          <span className="brand-icon"><Trophy size={17} aria-hidden="true" /></span>
          <div>
            <p className="brand-title"><span className="brand-title-full">Fantasy Basketball Desk</span><span className="brand-title-compact">Fantasy Desk</span></p>
            <p className="brand-subtitle">Yahoo roster intelligence</p>
          </div>
        </div>
        <nav className="header-nav" aria-label="Workspace">
          <Link href="/" className={pathname === "/" ? "active" : ""} aria-label="Dashboard" aria-current={pathname === "/" ? "page" : undefined} title="Dashboard">
            <LayoutDashboard size={14} /><span>Dashboard</span>
          </Link>
          <Link href="/draft" className={pathname.startsWith("/draft") ? "active" : ""} aria-label="Draft Assistant" aria-current={pathname.startsWith("/draft") ? "page" : undefined} title="Draft Assistant">
            <ListOrdered size={14} /><span>Draft Assistant</span>
          </Link>
        </nav>
        <div className="header-actions">
          {demoMode ? <span className="demo-badge">Demo data</span> : null}
          <button className="icon-button" onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}
