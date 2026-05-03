import { useEffect, useRef } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { AnnouncerHost } from '../../lib/a11y/announcer.js';
import { ToastHost } from '../../sdk/ToastHost.js';
import { ExternalLinkIcon } from '../../components/icons.js';

export function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mainRef = useRef<HTMLElement>(null);

  // Route changes move focus to the content landmark for keyboard/AT users.
  useEffect(() => {
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col bg-[#000000] text-[#f2f2f2]">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      {/* Global Brand Header */}
      <header className="sticky top-0 z-40 border-b border-[#27272a] bg-[#000000]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-4">
            <Link to="/" className="group flex items-center gap-2.5 font-semibold text-[#f2f2f2]">
              <div className="flex h-8 w-8 items-center justify-between rounded-[6px] border border-[#27272a] bg-[#0c0a09] p-1.5 shadow-[0_0_12px_rgba(34,197,94,0.15)] transition-all group-hover:border-[#22c55e]/50">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-full w-full"
                >
                  <path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
                  <circle cx="12" cy="19" r="1.5" fill="#22c55e" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-[#f2f2f2]">
                  Design Notification Service
                </span>
                <span className="text-[10px] font-mono text-[#a1a1aa] tracking-wider uppercase">
                  Algomaster Architecture
                </span>
              </div>
            </Link>

            <span className="hidden items-center rounded-[4px] border border-[#27272a] bg-[#111113] px-2 py-0.5 text-[11px] font-mono text-[#a1a1aa] md:inline-flex">
              v1.0 · Token-Driven UI
            </span>
          </div>

          <nav aria-label="Primary navigation" className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/"
              className="btn btn-sm btn-ghost"
              activeProps={{
                'aria-current': 'page',
                className: 'btn btn-sm bg-[#18181b] border-[#3f3f46] text-[#22c55e]',
              }}
            >
              Overview
            </Link>

            <Link
              to="/docs"
              className="btn btn-sm btn-ghost"
              activeProps={{
                'aria-current': 'page',
                className: 'btn btn-sm bg-[#18181b] border-[#3f3f46] text-[#22c55e]',
              }}
            >
              System Design & UI Spec
            </Link>

            <Link
              to="/playground"
              search={{ user: 'user-42' }}
              className="btn btn-sm btn-ghost"
              activeProps={{
                'aria-current': 'page',
                className: 'btn btn-sm bg-[#18181b] border-[#3f3f46] text-[#22c55e]',
              }}
            >
              Live Playground
            </Link>

            <div className="h-4 w-[1px] bg-[#27272a]" aria-hidden="true" />

            <a
              href="https://algomaster.io/learn/system-design-interviews/design-notification-service"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-[6px] border border-[#27272a] bg-[#0c0a09] px-2.5 py-1 text-xs text-[#a1a1aa] transition-colors hover:border-[#3f3f46] hover:text-[#f2f2f2] sm:inline-flex"
            >
              <span>Algomaster</span>
              <ExternalLinkIcon width={12} height={12} />
              <span className="sr-only">(opens external Algomaster interview guide)</span>
            </a>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main id="main" ref={mainRef} tabIndex={-1} aria-label="Main content" className="flex-1 outline-none">
        <Outlet />
      </main>

      {/* Technical Footer */}
      <footer className="border-t border-[#27272a] bg-[#0c0a09] py-8 text-xs text-[#a1a1aa]">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-6 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <p className="font-medium text-[#f2f2f2]">
              Design Notification Service — Production-Ready Real-Time Engine
            </p>
            <p className="max-w-[70ch] leading-relaxed text-[#a1a1aa]">
              PostgreSQL is the durable source of truth. Redis Pub/Sub provides lossy real-time hints.
              Every subscriber maintains a gapless monotonically increasing sequence cursor for deterministic zero-loss replay.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono">
            <span className="rounded-[4px] border border-[#27272a] bg-[#000000] px-2 py-1 text-[#22c55e]">
              WCAG 2.2 AA Compliant
            </span>
            <span className="rounded-[4px] border border-[#27272a] bg-[#000000] px-2 py-1 text-[#a1a1aa]">
              Keyboard First
            </span>
            <a
              href="https://algomaster.io/learn/system-design-interviews/design-notification-service"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#a1a1aa] underline hover:text-[#22c55e]"
            >
              Algomaster Reference Guide
            </a>
          </div>
        </div>
      </footer>

      <ToastHost />
      <AnnouncerHost />
    </div>
  );
}
