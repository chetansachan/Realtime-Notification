// [initial module draft]
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

let registered = false;

/** Registered exactly once; components must never call registerPlugin. */
export function registerGsap(): void {
  if (registered) return;
  if (typeof window === 'undefined') return;
  gsap.registerPlugin(Flip, ScrollTrigger, useGSAP);
  registered = true;
}

registerGsap();

export { gsap, Flip, ScrollTrigger, useGSAP };
