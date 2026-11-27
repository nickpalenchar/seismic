import { Lightbulb } from 'lucide-react';
import type { Severity } from '../../core/types';

/** Severity shapes inherit the colour of their count or badge. */
export function ReviewSeverityIcon({ severity }: { severity: Severity }) {
  const className = 'inline-block size-3.5 shrink-0 align-middle';
  if (severity === 'info') return <Lightbulb className={className} strokeWidth={2} aria-hidden="true" />;
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {severity === 'low' ? <circle cx="8" cy="8" r="4" />
        : severity === 'minor' ? <rect x="3" y="3" width="10" height="10" />
        : severity === 'major' ? <path d="M8 1 15 8 8 15 1 8Z" />
        : <>
          <path d="M8 0 13 5 8 10 3 5Z M8 6 13 11 8 16 3 11Z" />
          {severity === 'blocker' && <path d="M8 4.5v5M8 11.5v.1" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" />}
        </>}
    </svg>
  );
}
