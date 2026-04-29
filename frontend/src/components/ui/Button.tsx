// [initial module draft]
import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}

/**
 * Design Notification Service - Button Component
 *
 * Explicit token-driven state behavior:
 * - Default: surface.raised background, border.default, text.primary
 * - Hover: surface elevation, border highlight
 * - Focus-visible: WCAG 2.2 AA compliant focus ring (2px solid #22c55e, 2px offset)
 * - Active: scale(0.97) spring press transition
 * - Disabled: pointer-events-none, opacity: 0.45, aria-disabled="true"
 * - Loading: aria-busy="true", animated spinner, original label preserved for layout stability
 */
export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const variantClass = {
    default: 'btn',
    primary: 'btn btn-primary',
    secondary: 'btn bg-[#18181b] border-[#3f3f46] text-[#f2f2f2] hover:bg-[#27272a]',
    ghost: 'btn btn-ghost',
    danger: 'btn bg-[#7f1d1d]/30 border-[#ef4444]/40 text-[#fca5a5] hover:bg-[#7f1d1d]/50 hover:border-[#ef4444]',
  }[variant];

  const sizeClass = {
    sm: 'btn-sm',
    md: '',
    lg: 'min-h-[42px] px-5 text-sm',
  }[size];

  return (
    <button
      type={type}
      className={clsx(variantClass, sizeClass, className)}
      aria-busy={loading ? true : undefined}
      aria-disabled={isDisabled ? true : undefined}
      disabled={isDisabled}
      {...rest}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span>{children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
