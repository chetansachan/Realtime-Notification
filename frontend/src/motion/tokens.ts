/**
 * Design Notification Service - Motion Tokens
 * Durations in seconds for GSAP (CSS uses milliseconds in tokens.css)
 *
 * motion.duration.instant = 150ms (0.15s)
 * motion.duration.fast    = 200ms (0.20s)
 * motion.duration.normal  = 300ms (0.30s)
 * motion.duration.slow    = 1000ms (1.00s)
 */
export const motion = {
  instant: 0.15,
  fast: 0.2,
  normal: 0.3,
  slow: 1.0,
  ease: {
    standard: 'power2.out',
    emphasized: 'expo.out',
    exit: 'power2.in',
    spring: 'elastic.out(1, 0.75)',
  },
} as const;

/** Extended motion tokens for architecture timelines and packet animations. */
export const motionExtended = {
  packet: 0.8,
  story: 1.2,
  pulse: 1.5,
} as const;
