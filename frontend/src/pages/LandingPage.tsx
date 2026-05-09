import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { gsap, useGSAP } from '../motion/gsap.js';
import { useReducedMotion } from '../motion/useReducedMotion.js';
import { useReveal } from '../motion/useReveal.js';
import { Button } from '../components/ui/Button.js';
import { CheckIcon } from '../components/icons.js';

const ARCHITECTURE_STEPS = [
  {
    step: '01',
    title: 'Idempotent Ingestion',
    tech: 'POST /v1/notify',
    desc: 'Host services send notifications with an Idempotency-Key. Requests are authenticated via SHA-256 hashed API keys and rate-limited via Redis sliding windows.',
  },
  {
    step: '02',
    title: 'Monotonic ACID Commit',
    tech: 'PostgreSQL Stream Row',
    desc: 'Each recipient stream atomically increments its monotonic last_seq under a row lock. Commit order strictly equals sequence order with zero gaps.',
  },
  {
    step: '03',
    title: 'Lossy Realtime Hint',
    tech: 'Redis Pub/Sub (Refcounted)',
    desc: 'Immediate wake-up signal published to refcounted channel ntf:app:user. If Redis drops the packet, no notification is lost because Postgres retains it.',
  },
  {
    step: '04',
    title: 'Connection Dispatch',
    tech: 'SSE / WebSocket Replicas',
    desc: 'The specific API instance holding the recipient browser tab dispatches the event down the active HTTP SSE stream with bounded queue backpressure.',
  },
  {
    step: '05',
    title: 'Deterministic Replay',
    tech: 'Last-Event-ID Cursor',
    desc: 'If a client disconnects, it reconnects supplying its last seen sequence. The 3-phase handoff replays PostgreSQL events first, then seamlessly streams live.',
  },
] as const;

const CODE_EXAMPLES = {
  react: `import { NotificationProvider, Bell, InboxPanel } from '@design-notification/react';

export function App() {
  return (
    <NotificationProvider
      userId="user-42"
      apiBase="https://notify.example.com"
      session={authSession}
      autoConnect
    >
      <header className="flex justify-between items-center p-4">
        <h1>Dashboard</h1>
        <Bell />
      </header>
    </NotificationProvider>
  );
}`,
  sse: `// Raw browser EventSource with automatic sequence resume
const streamUrl = new URL('https://notify.example.com/v1/stream');
streamUrl.searchParams.set('ticket', singleUseTicket);
streamUrl.searchParams.set('lastEventId', localStorage.getItem('last_seq') || '0');

const eventSource = new EventSource(streamUrl);

eventSource.addEventListener('notification', (event) => {
  const payload = JSON.parse(event.data);
  console.log('Received sequence:', event.lastEventId, payload);
  localStorage.setItem('last_seq', event.lastEventId);
});`,
  ingest: `# Ingest notification via authenticated host API
curl -X POST https://notify.example.com/v1/notify \\
  -H "Authorization: Bearer ntf_live_abc123_xyz789" \\
  -H "Idempotency-Key: invoice-94812" \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "user-42",
    "category": "billing",
    "title": "Payment Succeeded",
    "body": "Invoice #94812 has been settled successfully.",
    "channels": ["in_app", "email"]
  }'`,
};

export function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const howItWorksRef = useReveal<HTMLElement>();
  const replayRef = useReveal<HTMLElement>();
  const comparisonRef = useReveal<HTMLElement>();
  const codeRef = useReveal<HTMLElement>();

  const [activeCodeTab, setActiveCodeTab] = useState<'react' | 'sse' | 'ingest'>('react');
  const [copied, setCopied] = useState(false);

  useGSAP(
    () => {
      if (reduced) return;
      const timeline = gsap.timeline();

      timeline
        .fromTo(
          '[data-hero-pill]',
          { opacity: 0, y: -10 },
          { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
        )
        .fromTo(
          '[data-hero-line]',
          { yPercent: 100, opacity: 0 },
          {
            yPercent: 0,
            opacity: 1,
            duration: 0.8,
            ease: 'expo.out',
            stagger: 0.08,
          },
          '-=0.2',
        )
        .fromTo(
          '[data-hero-fade]',
          { y: 16, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            ease: 'power2.out',
            stagger: 0.08,
          },
          '-=0.4',
        );
    },
    { scope: heroRef, dependencies: [reduced] },
  );

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(CODE_EXAMPLES[activeCodeTab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col bg-[#000000] text-[#f2f2f2]">
      {/* Hero Section */}
      <section
        ref={heroRef}
        className="relative overflow-hidden border-b border-[#27272a] bg-gradient-to-b from-[#0c0a09] via-[#000000] to-[#000000] py-20 lg:py-28"
      >
        {/* Subtle grid background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(#f2f2f2 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
          aria-hidden="true"
        />

        <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-4 text-center sm:px-6">
          {/* Badge */}
          <div
            data-hero-pill
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#27272a] bg-[#0c0a09] px-3.5 py-1.5 text-xs text-[#a1a1aa] shadow-inner"
          >
            <span className="flex h-2 w-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]" />
            <span className="font-mono text-[#f2f2f2]">Design Notification Service</span>
            <span className="text-[#3f3f46]">·</span>
            <span className="text-[#22c55e]">Algomaster System Design Architecture</span>
          </div>

          {/* Main Headline with Stagger Line Masking */}
          <h1 className="max-w-[900px] text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            <span className="block overflow-hidden pb-1">
              <span className="block" data-hero-line>
                Zero-Loss Realtime
              </span>
            </span>
            <span className="block overflow-hidden pb-1">
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#f2f2f2] via-[#f2f2f2] to-[#22c55e]" data-hero-line>
                Notification Engine.
              </span>
            </span>
          </h1>

          {/* Subtitle */}
          <p
            data-hero-fade
            className="mt-6 max-w-[680px] text-base leading-relaxed text-[#a1a1aa] sm:text-lg"
          >
            Built for mission-critical developer systems. PostgreSQL guarantees monotonic durability;
            Redis Pub/Sub provides sub-10ms lossy hints. Every browser or device resumes exactly
            where it left off.
          </p>

          {/* CTAs */}
          <div data-hero-fade className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/playground"
              search={{ user: 'user-42' }}
              className="btn btn-primary min-h-[44px] px-6 text-sm font-semibold"
            >
              Open Live Playground
            </Link>
            <Link
              to="/docs"
              className="btn min-h-[44px] border-[#3f3f46] bg-[#18181b] px-6 text-sm text-[#f2f2f2] hover:bg-[#27272a]"
            >
              View System Architecture &amp; UI Spec
            </Link>
          </div>

          {/* Core Guarantees Quick Strip */}
          <div
            data-hero-fade
            className="mt-14 grid w-full max-w-[960px] grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {[
              ['Monotonic Seq', 'Gapless per-user counter'],
              ['PostgreSQL Truth', 'Zero lost commits'],
              ['Redis Pub/Sub', 'Sub-10ms fan-out hint'],
              ['WCAG 2.2 AA', 'Token-driven accessibility'],
            ].map(([title, detail]) => (
              <div
                key={title}
                className="flex flex-col items-center justify-center rounded-[8px] border border-[#27272a] bg-[#0c0a09]/80 p-3.5 backdrop-blur-sm"
              >
                <span className="text-xs font-semibold text-[#f2f2f2]">{title}</span>
                <span className="mt-0.5 text-[11px] font-mono text-[#a1a1aa]">{detail}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* System Architecture Flow */}
      <section
        ref={howItWorksRef}
        className="border-b border-[#27272a] py-20"
        aria-labelledby="architecture-flow"
      >
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="flex flex-col gap-2" data-reveal>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              Algomaster Distributed Pattern
            </span>
            <h2 id="architecture-flow" className="text-3xl font-bold tracking-tight text-[#f2f2f2]">
              How One Notification Traverses the System
            </h2>
            <p className="max-w-[700px] text-sm text-[#a1a1aa]">
              The critical guarantee of this architecture is that durability and monotonic sequence
              allocation happen synchronously in PostgreSQL before any pub/sub signal is emitted.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-5">
            {ARCHITECTURE_STEPS.map((step) => (
              <div
                key={step.step}
                className="group relative flex flex-col rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-5 transition-all hover:border-[#3f3f46] hover:shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
                data-reveal
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-[#22c55e]">{step.step}</span>
                  <span className="rounded-[4px] border border-[#27272a] bg-[#000000] px-1.5 py-0.5 text-[10px] font-mono text-[#a1a1aa]">
                    {step.tech}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-[#f2f2f2]">{step.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-[#a1a1aa]">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Replay vs Lossy Naive Architecture */}
      <section
        ref={replayRef}
        className="border-b border-[#27272a] bg-[#060608] py-20"
        aria-labelledby="durability-comparison"
      >
        <div className="mx-auto grid max-w-[1200px] gap-8 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div data-reveal className="flex flex-col gap-3">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              High-Availability Guarantees
            </span>
            <h2 id="durability-comparison" className="text-3xl font-bold tracking-tight text-[#f2f2f2]">
              Why Naive Pub/Sub Fails &amp; How Monotonic Replay Solves It
            </h2>
            <p className="text-sm leading-relaxed text-[#a1a1aa]">
              In conventional systems, if Redis Pub/Sub drops a packet or a user goes through a tunnel,
              the message vanishes forever. In our system, Redis is treated solely as an acceleration
              hint. The browser always connects with its current sequence cursor.
            </p>

            <div className="mt-4 grid gap-3 font-mono text-xs">
              <div className="flex items-center gap-2 rounded-[6px] border border-[#ef4444]/30 bg-[#7f1d1d]/10 p-3 text-[#fca5a5]">
                <span className="font-bold">✕ Naive Pub/Sub:</span>
                <span>Messages sent while offline are lost permanently.</span>
              </div>
              <div className="flex items-center gap-2 rounded-[6px] border border-[#22c55e]/30 bg-[#22c55e]/10 p-3 text-[#22c55e]">
                <span className="font-bold">✓ Our Architecture:</span>
                <span>Postgres replays seq 4, 5, 6 gapless on reconnect.</span>
              </div>
            </div>
          </div>

          {/* Interactive Replay Protocol Card */}
          <div
            data-reveal
            className="flex flex-col rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3 text-xs">
              <span className="font-mono font-semibold text-[#f2f2f2]">SSE Resume Handshake</span>
              <span className="rounded-[4px] bg-[#18181b] px-2 py-0.5 font-mono text-[11px] text-[#22c55e]">
                RFC 8895 Compatible
              </span>
            </div>

            <pre className="mt-4 overflow-x-auto rounded-[6px] border border-[#27272a] bg-[#000000] p-4 font-mono text-xs text-[#f2f2f2]">
              <span className="text-[#a1a1aa]"># Client reconnects after network drop:</span>{'\n'}
              <span className="text-[#22c55e]">GET</span> /v1/stream?ticket=st_98a7bc{'\n'}
              <span className="text-[#a1a1aa]">Last-Event-ID:</span> 42{'\n\n'}
              <span className="text-[#a1a1aa]"># Server 3-phase handoff replays backlog:</span>{'\n'}
              <span className="text-[#22c55e]">id: 43</span>{'\n'}
              event: notification{'\n'}
              data: {`{"seq":43,"category":"billing","title":"Invoice Paid"}`}{'\n\n'}
              <span className="text-[#22c55e]">id: 44</span>{'\n'}
              event: notification{'\n'}
              data: {`{"seq":44,"category":"ops","title":"Deployment Complete"}`}
            </pre>

            <p className="mt-3 text-[11px] text-[#a1a1aa]">
              Notice how the stream ID equals the per-user sequence. Events without sequence (like
              read sync or heartbeats) never move the cursor.
            </p>
          </div>
        </div>
      </section>

      {/* Transport Comparison */}
      <section
        ref={comparisonRef}
        className="border-b border-[#27272a] py-20"
        aria-labelledby="transport-title"
      >
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="flex flex-col gap-2" data-reveal>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              Transport Engineering
            </span>
            <h2 id="transport-title" className="text-3xl font-bold tracking-tight text-[#f2f2f2]">
              SSE by Default, WebSocket by Need
            </h2>
            <p className="max-w-[700px] text-sm text-[#a1a1aa]">
              Notifications are fundamentally one-way (server to client). Server-Sent Events (SSE) provide
              automatic HTTP/2 multiplexing, native browser reconnection, and proxy transparency.
            </p>
          </div>

          <div className="mt-8 overflow-x-auto rounded-[8px] border border-[#27272a] bg-[#0c0a09]" data-reveal>
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Detailed transport mechanism comparison</caption>
              <thead>
                <tr className="border-b border-[#27272a] bg-[#111113] text-xs font-semibold text-[#a1a1aa]">
                  <th scope="col" className="p-3.5">Engineering Dimension</th>
                  <th scope="col" className="p-3.5 text-[#22c55e]">Server-Sent Events (Default)</th>
                  <th scope="col" className="p-3.5">WebSocket Transport</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a] text-xs">
                {[
                  ['Data Flow Direction', 'Server → Client (Unidirectional)', 'Bidirectional (Full Duplex)'],
                  ['Automatic Reconnection', 'Native browser standard (EventSource)', 'Custom heartbeat / retry client logic'],
                  ['Replay Cursor Support', 'Native Last-Event-ID header & query param', 'Custom resume handshake protocol message'],
                  ['Proxy & HTTP/2 Compatibility', '100% transparent through corporate proxies & WAFs', 'Requires protocol upgrade; proxies can drop'],
                  ['Connection Interface', 'Unified ConnectionRegistry in Fastify backend', 'Unified ConnectionRegistry in Fastify backend'],
                ].map(([dimension, sse, ws]) => (
                  <tr key={dimension} className="hover:bg-[#18181b]/50">
                    <td className="p-3.5 font-medium text-[#f2f2f2]">{dimension}</td>
                    <td className="p-3.5 font-mono text-[#22c55e]">{sse}</td>
                    <td className="p-3.5 font-mono text-[#a1a1aa]">{ws}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Developer Integration Code Section */}
      <section ref={codeRef} className="py-20" aria-labelledby="integration-title">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="flex flex-col gap-2" data-reveal>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
              Implementation-Ready
            </span>
            <h2 id="integration-title" className="text-3xl font-bold tracking-tight text-[#f2f2f2]">
              Drop-In SDK &amp; API Integration
            </h2>
            <p className="max-w-[700px] text-sm text-[#a1a1aa]">
              Everything you need to embed real-time notification feeds, connection pills, and unread badges
              into your applications.
            </p>
          </div>

          <div className="mt-8 rounded-[8px] border border-[#27272a] bg-[#0c0a09] shadow-2xl" data-reveal>
            {/* Tabs */}
            <div className="flex items-center justify-between border-b border-[#27272a] px-4 py-2.5">
              <div className="flex items-center gap-1">
                {(['react', 'sse', 'ingest'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveCodeTab(tab)}
                    className={`btn btn-sm rounded-[4px] text-xs font-medium ${
                      activeCodeTab === tab
                        ? 'bg-[#18181b] border-[#3f3f46] text-[#22c55e]'
                        : 'border-transparent text-[#a1a1aa] hover:text-[#f2f2f2]'
                    }`}
                  >
                    {tab === 'react' ? 'React SDK' : tab === 'sse' ? 'Native SSE Client' : 'cURL / API'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void copyCode()} aria-label="Copy code snippet">
                  {copied ? (
                    <span className="flex items-center gap-1 text-[#22c55e]">
                      <CheckIcon width={12} height={12} />
                      Copied
                    </span>
                  ) : (
                    'Copy Code'
                  )}
                </Button>
              </div>
            </div>

            {/* Code Body */}
            <pre className="max-h-[380px] overflow-auto p-4 font-mono text-xs leading-relaxed text-[#f2f2f2]">
              {CODE_EXAMPLES[activeCodeTab]}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
}
