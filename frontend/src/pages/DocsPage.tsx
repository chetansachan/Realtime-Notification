import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useReveal } from '../motion/useReveal.js';
import { Button } from '../components/ui/Button.js';
import { CheckIcon, ExternalLinkIcon } from '../components/icons.js';

const API_ROWS = [
  ['POST /v1/notify', 'API key', 'Create notification with Idempotency-Key support'],
  ['GET /v1/stream', 'JWT or ticket', 'SSE stream, honors Last-Event-ID and ?lastEventId='],
  ['GET /v1/ws', 'JWT or ticket', 'WebSocket transport, resume via {type:"resume",lastSeq}'],
  ['GET /v1/notifications', 'JWT', 'Keyset-paginated delivery history'],
  ['GET /v1/notifications/unread-count', 'JWT', 'Authoritative unread counter'],
  ['POST /v1/notifications/:id/read', 'JWT', 'Mark single item read (monotonic commit)'],
  ['POST /v1/notifications/read-all', 'JWT', 'Mark all read up to given sequence number'],
  ['GET|PUT /v1/preferences', 'JWT', 'Per-category mute and channel routing settings'],
  ['POST /v1/subscriber-tokens', 'API key', 'Mint short-lived subscriber JWT for browser/device'],
  ['POST /v1/stream-tickets', 'API key / JWT', 'Single-use SSE/WebSocket ticket (redacted from logs)'],
];

const COLOR_TOKENS = [
  { token: 'color.surface.base', hex: '#000000', role: 'Main background, deep true black' },
  { token: 'color.surface.raised', hex: '#0c0a09', role: 'Elevated panels, cards, and modal sheets' },
  { token: 'color.border.default', hex: '#27272a', role: 'Subtle high-contrast borders and dividers' },
  { token: 'color.surface.muted', hex: '#22c55e', role: 'Brand accent, system live status, success' },
  { token: 'color.text.primary', hex: '#f2f2f2', role: 'Primary text, headings, and labels' },
  { token: 'color.text.secondary', hex: '#a1a1aa', role: 'Secondary metadata, subtitles, timestamps' },
];

const TYPO_SCALE = [
  { token: 'font.size.xs', size: '12px', use: 'Badges, status chips, micro timestamps' },
  { token: 'font.size.sm', size: '13px', use: 'Buttons, table cells, secondary controls' },
  { token: 'font.size.md', size: '14px', use: 'Notification titles, inputs, body copy' },
  { token: 'font.size.lg', size: '16px', use: 'Card headings, prominent alerts' },
  { token: 'font.size.xl', size: '17px', use: 'Section headers, dialog titles' },
  { token: 'font.size.2xl', size: '18px', use: 'Base text size (line-height: 31.5px)' },
  { token: 'font.size.3xl', size: '20px', use: 'Major section titles' },
  { token: 'font.size.4xl', size: '24px', use: 'Page titles & hero accents' },
];

export function DocsPage() {
  const scope = useReveal<HTMLElement>();
  const [activeSection, setActiveSection] = useState<'architecture' | 'tokens' | 'components' | 'a11y' | 'qa'>('architecture');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  function copyText(text: string, token: string) {
    void navigator.clipboard.writeText(text);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 1800);
  }

  return (
    <article ref={scope} className="mx-auto max-w-[1100px] px-4 py-12 sm:px-6 text-[#f2f2f2]">
      {/* Header */}
      <div className="border-b border-[#27272a] pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]" />
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              System Design &amp; UI Architecture Spec
            </span>
          </div>

          <a
            href="https://algomaster.io/learn/system-design-interviews/design-notification-service"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#27272a] bg-[#0c0a09] px-3 py-1 text-xs text-[#a1a1aa] hover:border-[#3f3f46] hover:text-[#f2f2f2]"
          >
            <span>Algomaster Curriculum</span>
            <ExternalLinkIcon width={12} height={12} />
          </a>
        </div>

        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Design Notification Service
        </h1>
        <p className="mt-3 max-w-[85ch] text-base leading-relaxed text-[#a1a1aa]">
          Implementation-ready, token-driven UI guidance and distributed system architecture for
          Design Notification Service. Optimized for consistency, accessibility (WCAG 2.2 AA), and
          fast delivery across the documentation site.
        </p>

        {/* Quick Section Switcher */}
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            ['architecture', 'System Design & Architecture'],
            ['tokens', 'Design Tokens & Foundations'],
            ['components', 'Component Rules & Density'],
            ['a11y', 'Accessibility (WCAG 2.2 AA)'],
            ['qa', 'Quality Gates & QA Checklist'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id as any)}
              className={`btn btn-sm rounded-[4px] text-xs font-medium ${
                activeSection === id
                  ? 'bg-[#18181b] border-[#3f3f46] text-[#22c55e]'
                  : 'border-[#27272a] bg-[#0c0a09] text-[#a1a1aa] hover:text-[#f2f2f2]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* SECTION 1: SYSTEM DESIGN ARCHITECTURE */}
      {activeSection === 'architecture' ? (
        <section className="mt-10 grid gap-10">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              Core Invariant
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Durable First, Fast Second</h2>
            <p className="mt-3 text-base leading-relaxed text-[#a1a1aa]">
              Redis Pub/Sub informs API instances that something happened; it is{' '}
              <strong className="text-[#f2f2f2]">never the durable record</strong> of what happened.
              Every notification is committed to PostgreSQL before any pub/sub message is dispatched,
              and every missed event can be deterministically reconstructed from the subscriber&apos;s
              per-user monotonic sequence cursor.
            </p>
          </div>

          {/* Key Architecture Pillars */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
              <h3 className="text-base font-semibold text-[#f2f2f2]">1. Why Global Bigserial Fails</h3>
              <p className="mt-2 text-xs leading-relaxed text-[#a1a1aa]">
                A global auto-increment has a subtle replay bug: transaction A claims ID 10,
                transaction B claims ID 11. Transaction B commits first; the client sees 11,
                disconnects, and reconnects with <code className="text-[#22c55e]">Last-Event-ID: 11</code>.
                When transaction A commits later, row 10 is skipped and permanently lost.
              </p>
              <div className="mt-3 rounded-[6px] border border-[#27272a] bg-[#000000] p-3 font-mono text-[11px] text-[#22c55e]">
                user_streams (app_id, user_id, last_seq, unread_count)
              </div>
            </div>

            <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
              <h3 className="text-base font-semibold text-[#f2f2f2]">2. Monotonic Per-User Sequence</h3>
              <p className="mt-2 text-xs leading-relaxed text-[#a1a1aa]">
                Allocating sequence IDs from a per-user counter row within the same ACID transaction
                serializes concurrent writers for that user until commit. Therefore,{' '}
                <strong className="text-[#f2f2f2]">sequence order strictly equals commit order</strong>,
                and rollbacks leave no gaps.
              </p>
              <div className="mt-3 rounded-[6px] border border-[#27272a] bg-[#000000] p-3 font-mono text-[11px] text-[#a1a1aa]">
                INSERT ... ON CONFLICT DO UPDATE SET last_seq = last_seq + 1
              </div>
            </div>
          </div>

          {/* 3-Phase Replay Handoff */}
          <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-6">
            <h3 className="text-lg font-semibold text-[#f2f2f2]">The 3-Phase Replay Handoff</h3>
            <p className="mt-1 text-xs text-[#a1a1aa]">
              Solves the race condition between replaying historical DB records and capturing live incoming hints.
            </p>

            <ol className="mt-5 grid gap-3 text-xs md:grid-cols-3">
              <li className="rounded-[6px] border border-[#27272a] bg-[#000000] p-4">
                <span className="font-mono text-xs font-bold text-[#22c55e]">Phase 1</span>
                <h4 className="mt-1 font-semibold text-[#f2f2f2]">Subscribe &amp; Buffer</h4>
                <p className="mt-1.5 text-[#a1a1aa] leading-relaxed">
                  Register connection in buffering mode and await Redis SUBSCRIBE acknowledgement.
                  Live events arriving now are buffered locally.
                </p>
              </li>

              <li className="rounded-[6px] border border-[#27272a] bg-[#000000] p-4">
                <span className="font-mono text-xs font-bold text-[#22c55e]">Phase 2</span>
                <h4 className="mt-1 font-semibold text-[#f2f2f2]">Replay from Postgres</h4>
                <p className="mt-1.5 text-[#a1a1aa] leading-relaxed">
                  Execute query <code className="text-[#22c55e]">WHERE seq &gt; $lastEventId ORDER BY seq LIMIT n</code>{' '}
                  and push through the SSE stream.
                </p>
              </li>

              <li className="rounded-[6px] border border-[#27272a] bg-[#000000] p-4">
                <span className="font-mono text-xs font-bold text-[#22c55e]">Phase 3</span>
                <h4 className="mt-1 font-semibold text-[#f2f2f2]">Drain Buffer &amp; Live</h4>
                <p className="mt-1.5 text-[#a1a1aa] leading-relaxed">
                  Discard buffered items already satisfied by the replay (seq &le; lastSentSeq),
                  flush the remainder, and switch to live streaming.
                </p>
              </li>
            </ol>
          </div>

          {/* API Surface Table */}
          <div>
            <h3 className="text-lg font-semibold text-[#f2f2f2]">API Surface (v1 Specification)</h3>
            <div className="mt-4 overflow-x-auto rounded-[8px] border border-[#27272a] bg-[#0c0a09]">
              <table className="w-full border-collapse text-left text-xs">
                <caption className="sr-only">Notification service endpoints</caption>
                <thead>
                  <tr className="border-b border-[#27272a] bg-[#111113] text-[#a1a1aa]">
                    <th scope="col" className="p-3 font-semibold">Endpoint</th>
                    <th scope="col" className="p-3 font-semibold">Authentication</th>
                    <th scope="col" className="p-3 font-semibold">Purpose &amp; Semantics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272a]">
                  {API_ROWS.map(([endpoint, auth, purpose]) => (
                    <tr key={endpoint} className="hover:bg-[#18181b]/50">
                      <td className="p-3 font-mono font-medium text-[#22c55e]">{endpoint}</td>
                      <td className="p-3 font-mono text-[#a1a1aa]">{auth}</td>
                      <td className="p-3 text-[#f2f2f2]">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* SECTION 2: DESIGN TOKENS & FOUNDATIONS */}
      {activeSection === 'tokens' ? (
        <section className="mt-10 grid gap-10">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              Design Foundations
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Style &amp; Token System</h2>
            <p className="mt-2 text-sm text-[#a1a1aa]">
              Clean, functional, and implementation-oriented. Raw hex values are prohibited in component
              markup; components must consume semantic tokens.
            </p>
          </div>

          {/* Color Palette Tokens */}
          <div>
            <h3 className="text-base font-semibold text-[#f2f2f2]">Color Tokens</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COLOR_TOKENS.map((col) => (
                <div
                  key={col.token}
                  className="flex flex-col justify-between rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-8 w-8 rounded-[4px] border border-[#27272a]"
                      style={{ backgroundColor: col.hex }}
                    />
                    <div>
                      <p className="font-mono text-xs font-semibold text-[#f2f2f2]">{col.token}</p>
                      <p className="font-mono text-[11px] text-[#a1a1aa]">{col.hex}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-[#a1a1aa]">{col.role}</p>
                  <Button
                    size="sm"
                    className="mt-2 w-full text-[11px]"
                    onClick={() => copyText(col.hex, col.token)}
                  >
                    {copiedToken === col.token ? 'Copied Hex' : 'Copy Value'}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Typography Scale */}
          <div>
            <h3 className="text-base font-semibold text-[#f2f2f2]">Typography Scale</h3>
            <div className="mt-4 overflow-x-auto rounded-[8px] border border-[#27272a] bg-[#0c0a09]">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#27272a] bg-[#111113] text-[#a1a1aa]">
                    <th className="p-3 font-semibold">Token</th>
                    <th className="p-3 font-semibold">Pixel Size</th>
                    <th className="p-3 font-semibold">Sample</th>
                    <th className="p-3 font-semibold">Target Usage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272a]">
                  {TYPO_SCALE.map((item) => (
                    <tr key={item.token}>
                      <td className="p-3 font-mono text-[#22c55e]">{item.token}</td>
                      <td className="p-3 font-mono text-[#f2f2f2]">{item.size}</td>
                      <td className="p-3 font-medium text-[#f2f2f2]" style={{ fontSize: item.size }}>
                        Notification Engine
                      </td>
                      <td className="p-3 text-[#a1a1aa]">{item.use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Spacing & Radius Scales */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
              <h3 className="text-base font-semibold text-[#f2f2f2]">Spacing Scale</h3>
              <p className="mt-1 text-xs text-[#a1a1aa]">Strict 2px-increment rhythm tokens.</p>
              <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-xs">
                {[
                  ['space.1', '2px'],
                  ['space.2', '4px'],
                  ['space.3', '6px'],
                  ['space.4', '8px'],
                  ['space.5', '10px'],
                  ['space.6', '12px'],
                  ['space.7', '16px'],
                  ['space.8', '20px'],
                ].map(([token, val]) => (
                  <div key={token} className="flex justify-between rounded-[4px] border border-[#27272a] bg-[#000000] p-2">
                    <span className="text-[#a1a1aa]">{token}</span>
                    <span className="text-[#22c55e]">{val}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
              <h3 className="text-base font-semibold text-[#f2f2f2]">Radius &amp; Motion Tokens</h3>
              <p className="mt-1 text-xs text-[#a1a1aa]">Curvature and duration specifications.</p>
              <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-xs">
                {[
                  ['radius.xs', '4px'],
                  ['radius.sm', '6px'],
                  ['radius.md', '8px'],
                  ['radius.lg', '9999px (pill)'],
                  ['motion.duration.instant', '150ms'],
                  ['motion.duration.fast', '200ms'],
                  ['motion.duration.normal', '300ms'],
                  ['motion.duration.slow', '1000ms'],
                ].map(([token, val]) => (
                  <div key={token} className="flex justify-between rounded-[4px] border border-[#27272a] bg-[#000000] p-2">
                    <span className="text-[#a1a1aa]">{token}</span>
                    <span className="text-[#22c55e]">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* SECTION 3: COMPONENT RULES & DENSITY */}
      {activeSection === 'components' ? (
        <section className="mt-10 grid gap-8">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              Component Guidance
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Component-Level Rules &amp; Density</h2>
            <p className="mt-2 text-sm text-[#a1a1aa]">
              Every interactive element must define 7 mandatory states: default, hover, focus-visible,
              active, disabled, loading, and error.
            </p>
          </div>

          {/* Component Density Breakdown */}
          <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
            <h3 className="text-base font-semibold text-[#f2f2f2]">Known Page Component Density</h3>
            <p className="mt-1 text-xs text-[#a1a1aa]">Total component inventory across documentation and live playground:</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 font-mono text-xs text-center">
              {[
                ['Links', '131'],
                ['Buttons', '97'],
                ['Lists', '13'],
                ['Cards', '11'],
                ['Inputs', '8'],
                ['Navigation', '4'],
              ].map(([type, count]) => (
                <div key={type} className="rounded-[6px] border border-[#27272a] bg-[#000000] p-3">
                  <span className="text-xl font-bold text-[#22c55e]">{count}</span>
                  <span className="block mt-1 text-[#a1a1aa]">{type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Component State Matrix */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
              <h3 className="text-base font-semibold text-[#f2f2f2]">Notification Bell &amp; Badge</h3>
              <ul className="mt-3 grid gap-2 text-xs text-[#a1a1aa]">
                <li>• <strong className="text-[#f2f2f2]">Default:</strong> 40x40px, surface.raised, border.default.</li>
                <li>• <strong className="text-[#f2f2f2]">Hover:</strong> Background elevates to #18181b, border #3f3f46.</li>
                <li>• <strong className="text-[#f2f2f2]">Focus-visible:</strong> 2px solid #22c55e, offset 2px.</li>
                <li>• <strong className="text-[#f2f2f2]">Active (Press):</strong> scale(0.96) instant GSAP transition.</li>
                <li>• <strong className="text-[#f2f2f2]">New Arrival:</strong> Rings dynamically with GSAP rotation keyframes (-14deg to +12deg).</li>
                <li>• <strong className="text-[#f2f2f2]">Badge Overflow:</strong> Formats &gt;99 as &apos;99+&apos;; aria-label announces actual numeric unread count.</li>
              </ul>
            </div>

            <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
              <h3 className="text-base font-semibold text-[#f2f2f2]">Notification Item</h3>
              <ul className="mt-3 grid gap-2 text-xs text-[#a1a1aa]">
                <li>• <strong className="text-[#f2f2f2]">Content Security:</strong> Strictly renders untrusted title and body as string text, never raw HTML.</li>
                <li>• <strong className="text-[#f2f2f2]">Link Validation:</strong> Only HTTPS links permitted; rel=&quot;noopener noreferrer&quot; enforced.</li>
                <li>• <strong className="text-[#f2f2f2]">Unread State:</strong> Green unread indicator dot and explicit &quot;Unread.&quot; text for screen readers.</li>
                <li>• <strong className="text-[#f2f2f2]">Actions:</strong> &quot;Mark read&quot; button disabled when read or pending with aria-busy.</li>
                <li>• <strong className="text-[#f2f2f2]">Overflow:</strong> Title clamped at 2 lines, body clamped at 3 lines with overflow-wrap anywhere.</li>
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {/* SECTION 4: ACCESSIBILITY (WCAG 2.2 AA) */}
      {activeSection === 'a11y' ? (
        <section className="mt-10 grid gap-8">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              Compliance Criteria
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Accessibility (WCAG 2.2 AA)</h2>
            <p className="mt-2 text-sm text-[#a1a1aa]">
              All components must pass testable acceptance criteria under keyboard-only navigation and
              assistive technology.
            </p>
          </div>

          <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
            <h3 className="text-base font-semibold text-[#f2f2f2]">Acceptance Matrix</h3>
            <div className="mt-4 grid gap-3 text-xs md:grid-cols-3">
              <div className="rounded-[6px] border border-[#27272a] bg-[#000000] p-4">
                <span className="font-mono font-bold text-[#22c55e]">PASS CRITERIA 1</span>
                <h4 className="mt-1 font-semibold text-[#f2f2f2]">Keyboard Navigation</h4>
                <p className="mt-1 text-[#a1a1aa]">
                  Tab moves sequentially through links, buttons, and form inputs. Space/Enter triggers actions.
                  Escape closes popovers and dismisses active toasts.
                </p>
              </div>

              <div className="rounded-[6px] border border-[#27272a] bg-[#000000] p-4">
                <span className="font-mono font-bold text-[#22c55e]">PASS CRITERIA 2</span>
                <h4 className="mt-1 font-semibold text-[#f2f2f2]">Visible Focus Rings</h4>
                <p className="mt-1 text-[#a1a1aa]">
                  Hidden focus outlines are strictly prohibited. Focus rings must render as{' '}
                  <code className="text-[#22c55e]">2px solid #22c55e</code> with 2px offset.
                </p>
              </div>

              <div className="rounded-[6px] border border-[#27272a] bg-[#000000] p-4">
                <span className="font-mono font-bold text-[#22c55e]">PASS CRITERIA 3</span>
                <h4 className="mt-1 font-semibold text-[#f2f2f2]">Contrast Ratios</h4>
                <p className="mt-1 text-[#a1a1aa]">
                  Normal text (#f2f2f2) against #000000 delivers 18.2:1 contrast (well exceeding the 4.5:1
                  minimum). Secondary text (#a1a1aa) delivers 7.3:1 contrast.
                </p>
              </div>
            </div>
          </div>

          {/* Anti-Patterns */}
          <div className="rounded-[8px] border border-[#ef4444]/30 bg-[#7f1d1d]/10 p-5">
            <h3 className="text-base font-semibold text-[#fca5a5]">Anti-Patterns &amp; Prohibited Implementations</h3>
            <ul className="mt-3 grid gap-2 text-xs text-[#fca5a5]">
              <li>• <strong>PROHIBITED:</strong> Never use color as the sole indicator of connection status. Must pair with clear text.</li>
              <li>• <strong>PROHIBITED:</strong> Never introduce one-off spacing (e.g. margin: 13px) or inline hardcoded hex colors.</li>
              <li>• <strong>PROHIBITED:</strong> Never render untrusted notification payloads with dangerouslySetInnerHTML.</li>
              <li>• <strong>PROHIBITED:</strong> Never omit focus-visible outlines or suppress outline with outline: none without fallback.</li>
            </ul>
          </div>
        </section>
      ) : null}

      {/* SECTION 5: QA CHECKLIST */}
      {activeSection === 'qa' ? (
        <section className="mt-10 grid gap-8">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              Verification
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Implementation QA Checklist</h2>
            <p className="mt-2 text-sm text-[#a1a1aa]">
              Verification gate for engineering teams before releasing notification features.
            </p>
          </div>

          <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5">
            <div className="divide-y divide-[#27272a]">
              {[
                ['Token Adherence', 'All components use design tokens (color.surface.*, space.*, radius.*) instead of raw literals.'],
                ['State Coverage', 'Buttons and inputs implement default, hover, focus-visible, active, disabled, loading, and error states.'],
                ['Monotonic Sequencing', 'Events strictly commit in PostgreSQL before Redis publishing; client sequence is gapless.'],
                ['Replay Handshake', 'Simulated offline period of 10s recovers all missed notifications using Last-Event-ID on reconnect.'],
                ['Accessibility Audit', 'Full keyboard navigation operable with Tab, Enter, Space, Escape; screen reader announcer active.'],
                ['Reduced Motion Support', 'GSAP animations respect prefers-reduced-motion: reduce and fall back to instant transitions.'],
                ['Content Security', 'Untrusted HTML tags are sanitized and rendered as literal plain text; unsafe URL protocols rejected.'],
              ].map(([item, desc]) => (
                <div key={item} className="flex items-start gap-3 py-3.5">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[#22c55e]/20 text-[#22c55e]">
                    <CheckIcon width={14} height={14} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#f2f2f2]">{item}</p>
                    <p className="mt-0.5 text-xs text-[#a1a1aa]">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-4 text-xs">
            <span className="text-[#a1a1aa]">Ready to experience the real-time engine?</span>
            <Link to="/playground" search={{ user: 'user-42' }} className="btn btn-sm btn-primary">
              Launch Live Playground
            </Link>
          </div>
        </section>
      ) : null}
    </article>
  );
}
