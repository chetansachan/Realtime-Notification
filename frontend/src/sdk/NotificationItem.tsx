// [initial module draft]
import { useId } from 'react';
import type { NotificationItem as NotificationModel } from '../lib/types.js';
import { formatAbsolute, formatRelative, safeUrl } from '../lib/format.js';
import { ArrowUpRightIcon, CheckIcon } from '../components/icons.js';

export interface NotificationItemProps {
  item: NotificationModel;
  onRead?: (id: string) => void;
  reading?: boolean;
}

/**
 * Design Notification Service - Notification Item Component
 *
 * Rules:
 * - Content is untrusted: text only, never HTML.
 * - URLs must be validated (HTTPS only, rel="noopener noreferrer").
 * - Unread status is indicated both visually (dot, subtle green border) and for screen readers ("Unread.").
 * - States: default, hover, focus-visible, active, loading, disabled.
 */
export function NotificationItem({ item, onRead, reading = false }: NotificationItemProps) {
  const headingId = useId();
  const unread = item.readAt === null;
  const href = safeUrl(item.data?.url);
  const hasBody = typeof item.body === 'string' && item.body.length > 0;

  return (
    <article
      className="notification-item group"
      data-unread={unread}
      data-flip-id={item.id}
      aria-labelledby={headingId}
    >
      <div className="meta">
        <div className="flex items-center gap-2">
          <span className="chip text-[11px] font-mono text-[#a1a1aa]">{item.category}</span>
          {item.priority === 'urgent' ? (
            <span className="rounded-[4px] border border-[#ef4444]/40 bg-[#7f1d1d]/20 px-1.5 py-0.5 text-[10px] font-mono font-medium text-[#fca5a5]">
              Urgent
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-[12px] text-[#a1a1aa]">
          {unread ? <span className="unread-dot" aria-hidden="true" /> : null}
          {unread ? <span className="sr-only">Unread. </span> : null}
          <time dateTime={item.createdAt} title={formatAbsolute(item.createdAt)} className="text-[#a1a1aa]">
            {formatRelative(item.createdAt)}
          </time>
          <span className="sr-only">Sequence {item.seq}</span>
        </div>
      </div>

      <h3 id={headingId} className="title">
        {item.title || item.category}
      </h3>

      {hasBody ? <p className="body">{item.body}</p> : null}

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-[#27272a]/60 pt-2 text-xs">
        {href ? (
          <a
            className="inline-flex items-center gap-1 font-medium text-[#22c55e] hover:underline"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>Open</span>
            <ArrowUpRightIcon width={13} height={13} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <span className="font-mono text-[11px] text-[#a1a1aa]">seq #{item.seq}</span>
        )}

        {unread && onRead ? (
          <button
            type="button"
            className="btn btn-sm bg-[#18181b] border-[#3f3f46] text-[#f2f2f2] hover:bg-[#27272a] hover:text-[#22c55e]"
            onClick={() => onRead(item.id)}
            aria-label={`Mark "${item.title}" as read`}
            aria-busy={reading || undefined}
            disabled={reading}
          >
            <CheckIcon width={13} height={13} />
            <span>Mark read</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}
