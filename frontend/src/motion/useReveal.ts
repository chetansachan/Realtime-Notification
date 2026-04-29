import { useRef } from 'react';
import { gsap, useGSAP } from './gsap.js';
import { motion } from './tokens.js';
import { useReducedMotion } from './useReducedMotion.js';

/** Reveals `[data-reveal]` children when the container scrolls into view. */
export function useReveal<T extends HTMLElement>(options: { y?: number } = {}) {
  const scope = useRef<T>(null);
  const reduced = useReducedMotion();
  const y = options.y ?? 16;

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const targets = root.querySelectorAll<HTMLElement>('[data-reveal]');
      if (targets.length === 0) return;

      if (reduced) {
        gsap.set(targets, { opacity: 1, y: 0 });
        return;
      }

      gsap.fromTo(
        targets,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: motion.slow,
          ease: motion.ease.standard,
          stagger: 0.05,
          scrollTrigger: { trigger: root, start: 'top 85%', once: true },
        },
      );
    },
    { scope, dependencies: [reduced, y] },
  );

  return scope;
}
