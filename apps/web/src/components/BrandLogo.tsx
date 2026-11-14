import { useTheme } from '@/providers/theme-provider';

export function BrandLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const { theme } = useTheme();
  const source = compact
    ? '/branding/wattnexa-mark.svg'
    : theme === 'dark'
      ? '/branding/wattnexa-horizontal-inverse.svg'
      : '/branding/wattnexa-horizontal.svg';

  return (
    <img
      src={source}
      alt="WattNexa"
      className={className}
      width={compact ? 40 : 180}
      height={40}
      decoding="async"
      draggable={false}
    />
  );
}

export function WattbotLogo({ className = '' }: { className?: string }) {
  return (
    <img
      src="/branding/wattbot-mark.svg"
      alt="WattBot"
      className={className}
      width={40}
      height={40}
      decoding="async"
      draggable={false}
    />
  );
}
