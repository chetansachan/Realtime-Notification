// [initial module draft]
import { useMemo } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { useCategories, usePreferences, useUpdatePreferences } from '../features/preferences/queries.js';
import { announce } from '../lib/a11y/announcer.js';
import type { PreferenceItem } from '../lib/types.js';
import { LockIcon } from '../components/icons.js';
import { Button } from '../components/ui/Button.js';

const CHANNELS = ['in_app', 'email', 'webhook'] as const;
type Channel = (typeof CHANNELS)[number];

const CHANNEL_LABEL: Record<Channel, string> = {
  in_app: 'In-app',
  email: 'Email',
  webhook: 'Webhook',
};

interface Row {
  category: string;
  mandatory: boolean;
  muted: boolean;
  channels: Record<string, boolean>;
}

export function PreferencesPanel() {
  const preferences = usePreferences();
  const categories = useCategories();
  const update = useUpdatePreferences();

  const rows = useMemo<Row[]>(() => {
    const saved = new Map(
      (preferences.data?.items ?? []).map((item) => [item.category, item] as const),
    );
    const categoryRows = (categories.data?.items ?? []).map((category) => {
      const stored = saved.get(category.key);
      saved.delete(category.key);
      const defaults: Record<string, boolean> = {};
      for (const channel of CHANNELS) {
        defaults[channel] = category.defaultChannels.includes(channel);
      }
      return {
        category: category.key,
        mandatory: category.mandatory,
        muted: stored?.muted ?? false,
        channels: { ...defaults, ...(stored?.channels ?? {}) },
      } satisfies Row;
    });

    // Preferences for categories the server no longer lists still matter.
    for (const [category, item] of saved) {
      categoryRows.push({
        category,
        mandatory: false,
        muted: item.muted,
        channels: { ...item.channels },
      });
    }
    return categoryRows;
  }, [preferences.data, categories.data]);

  const loading = preferences.isPending || categories.isPending;
  const error = preferences.error ?? categories.error;

  function patch(category: string, change: Partial<Pick<Row, 'muted' | 'channels'>>) {
    const next: PreferenceItem[] = rows.map((row) => {
      if (row.category !== category) {
        return { category: row.category, muted: row.muted, channels: row.channels };
      }
      return {
        category: row.category,
        muted: change.muted ?? row.muted,
        channels: change.channels ?? row.channels,
      };
    });
    update.mutate(next, {
      onSuccess: () => announce('Preferences saved'),
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-[#a1a1aa]">
        <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
        <span>Loading preferences…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid gap-2 rounded-[6px] border border-[#ef4444]/30 bg-[#7f1d1d]/15 p-4 text-[#fca5a5]">
        <p className="text-xs">Preferences couldn&apos;t load from server.</p>
        <div>
          <Button size="sm" onClick={() => void preferences.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="p-4 text-xs text-[#a1a1aa]">
        No categories available yet. They will appear after your first notification event.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const locked = row.mandatory;
        const consequence = locked
          ? 'Required for account security (cannot be disabled)'
          : row.muted
            ? 'Muted in inbox (suppressed before monotonic seq)'
            : 'Active in-app notifications';

        return (
          <div
            key={row.category}
            className="grid gap-2.5 rounded-[6px] border border-[#27272a] bg-[#111113] p-3 text-[#f2f2f2]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold tracking-tight">{row.category}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-[#a1a1aa]">
                  {locked ? <LockIcon width={12} height={12} className="text-[#eab308]" /> : null}
                  <span>{consequence}</span>
                </p>
              </div>
              <Switch.Root
                className="switch"
                checked={!row.muted}
                disabled={locked}
                onCheckedChange={(checked) => patch(row.category, { muted: !checked })}
                aria-label={`${row.category}: in-app notifications`}
              >
                <Switch.Thumb className="switch-thumb" />
              </Switch.Root>
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-[#27272a]/70 pt-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#a1a1aa]">
                Delivery Channels:
              </span>
              {CHANNELS.map((channel) => (
                <label key={channel} className="flex items-center gap-1.5 text-xs text-[#a1a1aa]">
                  <Switch.Root
                    className="switch scale-90"
                    checked={row.channels[channel] ?? false}
                    disabled={locked || (channel === 'in_app' && row.muted)}
                    onCheckedChange={(checked) =>
                      patch(row.category, {
                        channels: { ...row.channels, [channel]: checked },
                      })
                    }
                    aria-label={`${row.category}: ${CHANNEL_LABEL[channel]} notifications`}
                  >
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                  <span>{CHANNEL_LABEL[channel]}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      <div className="min-h-[20px] text-xs font-mono text-[#22c55e]">
        {update.isPending
          ? 'Persisting preferences to database…'
          : update.isError
            ? "Couldn't save preferences. Please retry."
            : update.isSuccess
              ? '✓ Preferences synchronized'
              : ''}
      </div>
    </div>
  );
}
