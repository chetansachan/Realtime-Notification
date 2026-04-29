import { useEffect, useRef } from 'react';
import { gsap } from './gsap.js';
import { motion } from './tokens.js';
import { useReducedMotion } from './useReducedMotion.js';

/**
 * Tweens the rendered count. The accessible label is never animated — the badge
 * is aria-hidden and the trigger's name carries the real number.
 */
export function useCountTween(
  value: number,
  format: (value: number) => string = String,
): React.RefObject<HTMLSpanElement | null> {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reduced) {
      element.textContent = format(value);
      return;
    }
    const state = { value };
    const tween = gsap.to(state, {
      value,
      duration: motion.normal,
      ease: motion.ease.standard,
      onUpdate: () => {
        element.textContent = format(Math.round(state.value));
      },
      onComplete: () => {
        element.textContent = format(value);
      },
    });
    return () => {
      tween.kill();
    };
  }, [value, reduced, format]);

  return ref;
}
