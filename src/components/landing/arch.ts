/**
 * Geometry of a semicircular arch of wedge stones, the same construction as the logo: `n` stones
 * (odd, so the middle one is the keystone) between the inner and outer radius, with a gap between
 * neighbours. Returns one SVG path per stone, left to right.
 */
export function archStones(cx: number, cy: number, rOuter: number, rInner: number, n: number, gapDeg = 1.2): string[] {
  const step = 180 / n;
  const pt = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx - r * Math.cos(a)).toFixed(1)},${(cy - r * Math.sin(a)).toFixed(1)}`;
  };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = i * step + gapDeg / 2;
    const a1 = (i + 1) * step - gapDeg / 2;
    out.push(`M${pt(rOuter, a0)} A${rOuter} ${rOuter} 0 0 1 ${pt(rOuter, a1)} L${pt(rInner, a1)} A${rInner} ${rInner} 0 0 0 ${pt(rInner, a0)}Z`);
  }
  return out;
}
