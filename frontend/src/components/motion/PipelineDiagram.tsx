import { useRef, useState } from 'react';
import { gsap, useGSAP } from '../../motion/gsap.js';
import { useReducedMotion } from '../../motion/useReducedMotion.js';
import { useRealtimeStore } from '../../realtime/store.js';

export interface PipelineDiagramProps {
  /** Incremented when a send is accepted by the API. */
  runId: number;
  /** Latest notification seq the tab actually received. */
  lastSeq: number;
}

const NODES = ['app', 'api-a', 'redis', 'api-b', 'tab'] as const;
type NodeName = (typeof NODES)[number] | 'postgres';

interface NodeMeta {
  label: string;
  sub: string;
  badge: string;
}

const NODE_INFO: Record<NodeName, NodeMeta> = {
  app: { label: 'Host App', sub: 'POST /v1/notify', badge: 'Client' },
  'api-a': { label: 'API Ingest A', sub: 'Validate & Lock', badge: 'Instance A' },
  postgres: { label: 'PostgreSQL', sub: 'Monotonic Seq & Commit', badge: 'Source of Truth' },
  redis: { label: 'Redis Pub/Sub', sub: 'Publish hint (lossy)', badge: 'Broker' },
  'api-b': { label: 'API Instance B', sub: 'Subscriber Pool', badge: 'Instance B' },
  tab: { label: 'Browser Tab', sub: 'SSE Stream Client', badge: 'Subscriber' },
};

export function PipelineDiagram({ runId, lastSeq }: PipelineDiagramProps) {
  const scope = useRef<HTMLDivElement>(null);
  const packet = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const instanceId = useRealtimeStore((state) => state.instanceId);
  const previousRun = useRef(0);
  const previousSeq = useRef(0);
  const [activeStep, setActiveStep] = useState<string>('idle');

  const nodeElement = (name: NodeName): HTMLElement | null =>
    scope.current?.querySelector<HTMLElement>(`[data-node="${name}"]`) ?? null;

  const center = (name: NodeName): { x: number; y: number } | null => {
    const container = scope.current;
    const element = nodeElement(name);
    if (!container || !element) return null;
    const containerRect = container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top + rect.height / 2,
    };
  };

  const flash = (name: NodeName): void => {
    const element = nodeElement(name);
    if (!element) return;
    element.dataset.hot = 'true';
    gsap.to(element, {
      scale: 1.03,
      duration: 0.15,
      yoyo: true,
      repeat: 1,
      ease: 'power2.out',
    });
    gsap.delayedCall(0.7, () => {
      delete element.dataset.hot;
    });
  };

  const triggerSimulation = () => {
    if (!packet.current || reduced) return;
    const app = center('app');
    const apiA = center('api-a');
    const postgres = center('postgres');
    const redis = center('redis');
    const apiB = center('api-b');
    const tab = center('tab');
    if (!app || !apiA || !postgres || !redis || !apiB || !tab) return;

    gsap.killTweensOf(packet.current);
    gsap.set(packet.current, { x: app.x, y: app.y, opacity: 1, scale: 1 });
    flash('app');
    setActiveStep('Ingest: POST /v1/notify');

    const timeline = gsap.timeline({
      onComplete: () => {
        setActiveStep('Delivered: Stream received');
        gsap.to(packet.current, { opacity: 0, scale: 0.5, duration: 0.3, delay: 0.2 });
      },
    });

    timeline
      .to(packet.current, {
        x: apiA.x,
        y: apiA.y,
        duration: 0.22,
        ease: 'power2.inOut',
        onStart: () => {
          flash('api-a');
          setActiveStep('API Gateway: Rate limit & token check');
        },
      })
      .to(packet.current, {
        x: postgres.x,
        y: postgres.y,
        duration: 0.24,
        ease: 'power2.inOut',
        onStart: () => {
          flash('postgres');
          setActiveStep('PostgreSQL: Durable commit & allocate seq');
        },
      })
      .to(packet.current, {
        x: apiA.x,
        y: apiA.y,
        duration: 0.18,
        ease: 'power2.inOut',
      })
      .to(packet.current, {
        x: redis.x,
        y: redis.y,
        duration: 0.22,
        ease: 'power2.inOut',
        onStart: () => {
          flash('redis');
          setActiveStep('Redis Pub/Sub: Fan-out lossy hint');
        },
      })
      .to(packet.current, {
        x: apiB.x,
        y: apiB.y,
        duration: 0.22,
        ease: 'power2.inOut',
        onStart: () => {
          flash('api-b');
          setActiveStep('Instance B: Match connection in registry');
        },
      })
      .to(packet.current, {
        x: tab.x,
        y: tab.y,
        duration: 0.25,
        ease: 'power2.inOut',
        onStart: () => {
          flash('tab');
          setActiveStep('Client: SSE event received');
        },
      });
  };

  useGSAP(
    () => {
      if (runId === 0 || runId === previousRun.current) return;
      previousRun.current = runId;
      triggerSimulation();
    },
    { scope, dependencies: [runId, reduced] },
  );

  useGSAP(
    () => {
      if (lastSeq === 0 || lastSeq === previousSeq.current) return;
      previousSeq.current = lastSeq;
      if (reduced) {
        flash('tab');
        return;
      }
      const apiB = center('api-b');
      const tab = center('tab');
      if (!apiB || !tab || !packet.current) return;

      gsap.killTweensOf(packet.current);
      gsap.set(packet.current, { x: apiB.x, y: apiB.y, opacity: 1, scale: 1 });
      gsap.to(packet.current, {
        x: tab.x,
        y: tab.y,
        duration: 0.35,
        ease: 'power2.inOut',
        onStart: () => flash('tab'),
        onComplete: () => {
          gsap.to(packet.current, { opacity: 0, scale: 0.5, duration: 0.25, delay: 0.15 });
        },
      });
    },
    { scope, dependencies: [lastSeq, reduced] },
  );

  return (
    <div
      ref={scope}
      className="relative flex flex-col gap-4 rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-4 text-[#f2f2f2]"
      aria-label="Interactive Notification Pipeline Visualizer"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#27272a] pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-2.5 w-2.5 items-center justify-center">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22c55e]" />
            </span>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[#f2f2f2]">
            Distributed Event Pipeline
          </span>
          <span className="rounded-[4px] border border-[#27272a] bg-[#000000] px-2 py-0.5 text-[10px] font-mono text-[#22c55e]">
            Lossless Delivery
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeStep !== 'idle' ? (
            <span className="text-[11px] font-mono text-[#a1a1aa]" aria-live="polite">
              {activeStep}
            </span>
          ) : null}
          <button
            type="button"
            onClick={triggerSimulation}
            className="btn btn-sm bg-[#18181b] border-[#3f3f46] text-[#22c55e] hover:bg-[#27272a]"
            aria-label="Simulate packet transit through pipeline"
          >
            Pulse Test Packet
          </button>
        </div>
      </div>

      {/* Pipeline Main Grid */}
      <div className="relative my-2">
        <div className="pipeline-row">
          {NODES.map((node) => {
            const isApiB = node === 'api-b';
            const meta = NODE_INFO[node];
            const displayLabel = isApiB && instanceId ? instanceId : meta.label;

            return (
              <div
                key={node}
                className="pipeline-node group relative flex flex-col items-center justify-center p-2.5 text-center transition-all"
                data-node={node}
              >
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#a1a1aa]">
                  {meta.badge}
                </span>
                <span className="mt-0.5 text-xs font-semibold text-[#f2f2f2]">{displayLabel}</span>
                <span className="text-[10px] font-mono text-[#22c55e] opacity-80">{meta.sub}</span>
              </div>
            );
          })}
        </div>

        {/* PostgreSQL Row */}
        <div className="pipeline-row mt-3" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <div />
          <div
            className="pipeline-node pipeline-postgres group relative flex flex-col items-center justify-center p-2.5 text-center transition-all"
            data-node="postgres"
          >
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#22c55e]">
              ACID Source
            </span>
            <span className="mt-0.5 text-xs font-semibold text-[#f2f2f2]">PostgreSQL</span>
            <span className="text-[10px] font-mono text-[#a1a1aa]">Monotonic per-user seq</span>
          </div>
          <div className="col-span-3 flex items-center px-4 text-[11px] text-[#a1a1aa]">
            <p className="leading-snug">
              <span className="font-semibold text-[#22c55e]">Why this design?</span> Write locks
              per-user stream row in PostgreSQL. Sequence order equals commit order. Redis Pub/Sub
              acts only as an immediate wake-up hint.
            </p>
          </div>
        </div>

        {/* Glowing Animated Packet */}
        <div ref={packet} className="pipeline-packet" aria-hidden="true" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#27272a] pt-2.5 text-[11px] text-[#a1a1aa]">
        <div className="flex items-center gap-3 font-mono">
          <span>
            Last Sequence: <strong className="text-[#22c55e]">{lastSeq > 0 ? lastSeq : 'Ready'}</strong>
          </span>
          <span>·</span>
          <span>
            Active Instance: <strong className="text-[#f2f2f2]">{instanceId ?? 'Auto (Round-Robin)'}</strong>
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#a1a1aa]">
          Guaranteed Monotonicity: Gapless &amp; Idempotent
        </span>
      </div>
    </div>
  );
}
