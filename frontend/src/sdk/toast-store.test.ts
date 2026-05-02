import { beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from './toast-store.js';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('toast store', () => {
  it('coalesces notification bursts instead of stacking them', () => {
    useToastStore.getState().push({ kind: 'notification', title: 'First' });
    useToastStore.getState().push({ kind: 'notification', title: 'Second' });
    useToastStore.getState().push({ kind: 'notification', title: 'Third' });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.count).toBe(3);
    expect(toasts[0]?.title).toBe('3 new notifications');
  });

  it('keeps at most three toasts and lets errors coexist', () => {
    useToastStore.getState().push({ kind: 'error', title: 'Failed' });
    useToastStore.getState().push({ kind: 'info', title: 'Saved' });
    useToastStore.getState().push({ kind: 'info', title: 'Loaded' });
    useToastStore.getState().push({ kind: 'info', title: 'Another' });

    expect(useToastStore.getState().toasts).toHaveLength(3);
    expect(useToastStore.getState().toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });

  it('dismisses by id', () => {
    useToastStore.getState().push({ kind: 'error', title: 'Failed' });
    const id = useToastStore.getState().toasts[0]?.id;
    expect(id).toBeTruthy();
    useToastStore.getState().dismiss(id as string);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
