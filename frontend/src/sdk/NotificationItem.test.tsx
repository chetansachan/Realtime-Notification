import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationItem } from './NotificationItem.js';
import type { NotificationItem as NotificationModel } from '../lib/types.js';

const base: NotificationModel = {
  id: 'n1',
  seq: 1,
  category: 'billing',
  title: 'Invoice paid',
  body: 'Your invoice was paid.',
  data: null,
  priority: 'normal',
  createdAt: new Date().toISOString(),
  readAt: null,
};

describe('NotificationItem', () => {
  it('renders untrusted markup as text, never HTML', () => {
    render(<NotificationItem item={{ ...base, title: '<img src=x onerror="alert(1)">' }} />);

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('labels unread state in text and marks read on demand', async () => {
    const onRead = vi.fn();
    render(<NotificationItem item={base} onRead={onRead} />);

    expect(screen.getByText('Unread.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /mark "Invoice paid" as read/i }));
    expect(onRead).toHaveBeenCalledWith('n1');
  });

  it('drops unsafe links but keeps https links', () => {
    const { rerender } = render(
      <NotificationItem item={{ ...base, data: { url: 'javascript:alert(1)' } }} />,
    );
    expect(screen.queryByRole('link')).toBeNull();

    rerender(<NotificationItem item={{ ...base, data: { url: 'https://example.com/invoice' } }} />);
    const link = screen.getByRole('link', { name: /open/i });
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows no action for an already-read item', () => {
    render(<NotificationItem item={{ ...base, readAt: new Date().toISOString() }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
