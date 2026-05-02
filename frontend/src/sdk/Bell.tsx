// [initial module draft]
import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { BellIcon } from '../components/icons.js';
import { useRealtimeStore } from '../realtime/store.js';
import { useCountTween } from '../motion/useCountTween.js';
import { useReducedMotion } from '../motion/useReducedMotion.js';
import { gsap } from '../motion/gsap.js';
import { motion } from '../motion/tokens.js';
import { InboxPanel } from './InboxPanel.js';

const formatBadge = (value: number): string => (value > 99 ? '99+' : String(value));

export function Bell() {
  const unread = useRealtimeStore((state) => state.unreadCount);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previousUnread = useRef(unread);
  const reduced = useReducedMotion();
  const countRef = useCountTween(unread, formatBadge);

  useEffect(() => {
    if (unread > previousUnread.current && !reduced && buttonRef.current) {
      gsap.fromTo(
        buttonRef.current,
        { rotate: 0, scale: 1 },
        {
          keyframes: [
            { rotate: -14, scale: 1.1 },
            { rotate: 12, scale: 1.1 },
            { rotate: -8, scale: 1.05 },
            { rotate: 6, scale: 1.02 },
            { rotate: 0, scale: 1 },
          ],
          duration: motion.normal,
          ease: 'power2.out',
        },
      );
    }
    previousUnread.current = unread;
  }, [unread, reduced]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        useRealtimeStore.getState().setInboxOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={buttonRef}
          type="button"
          className="bell-button"
          aria-label={unread > 0 ? `Notification Center, ${unread} unread` : 'Notification Center'}
        >
          <BellIcon className="h-5 w-5 text-[#f2f2f2]" />
          {unread > 0 ? (
            <span className="bell-badge" aria-hidden="true">
              <span ref={countRef} className="tnum">
                {formatBadge(unread)}
              </span>
            </span>
          ) : null}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          aria-label="Notification center inbox"
          className="z-50 outline-none animate-in fade-in-0 zoom-in-95 duration-200"
        >
          <InboxPanel />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
