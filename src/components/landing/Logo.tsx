import { KeystoneMark } from '@/components/kit/Mark';

/**
 * The full-size logo: the keystone arch (hatched side stones, one solid apricot keystone) and the
 * wordmark in Onest 700. `field` is for the violet field, `paper` for lavender paper. The mark is
 * the kit's, so the landing, the product shell and the icons share one drawing.
 */
export function Logo({ surface = 'paper', size = 36, className }: { surface?: 'paper' | 'field'; size?: number; className?: string }) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.28),
        fontWeight: 700,
        fontSize: Math.round(size * 0.56),
        letterSpacing: '-0.03em',
        lineHeight: 1,
        color: surface === 'field' ? 'var(--on-violet)' : 'var(--ink)',
      }}
    >
      <KeystoneMark size={size} tone={surface === 'field' ? 'violet' : 'paper'} />
      Irreplaceable
    </span>
  );
}

/** The mark alone at a large size, for the closing section. */
export function LogoMark({ size = 200, surface = 'paper', className }: { size?: number; surface?: 'paper' | 'field'; className?: string }) {
  return <KeystoneMark size={size} tone={surface === 'field' ? 'violet' : 'paper'} className={className} />;
}
