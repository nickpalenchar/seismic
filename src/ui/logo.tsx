


import { GLYPH_SCALE, LETTERS, SIGN, WORD_W } from './logo/glyphs';

export function Sign({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <image width={32} height={32} href={SIGN} />
    </svg>
  );
}

/** The sign with "Seismic" beside it; `ink` colours the letters (the text colour by default). */
export function Wordmark({ height = 32, ink = 'currentColor' }: { height?: number; ink?: string }) {
  return (
    <svg height={height} width={+((WORD_W * height) / 32).toFixed(1)} viewBox={`0 0 ${WORD_W} 32`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Seismic">
      <image width={32} height={32} href={SIGN} />
      {LETTERS.map(([x, d]) => (
        <path key={x} transform={`translate(${x} 24) scale(${GLYPH_SCALE})`} d={d} fill={ink} />
      ))}
    </svg>
  );
}
