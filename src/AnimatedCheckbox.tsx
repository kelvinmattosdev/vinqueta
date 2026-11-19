import type { ComponentPropsWithoutRef } from 'react';

export default function AnimatedCheckbox(props: Omit<ComponentPropsWithoutRef<'input'>, 'type'>) {
  return <span className="animated-checkbox">
    <input {...props} type="checkbox" />
    <span className="checkbox-mark" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="m2 6 2.6 2.6L10 3" pathLength="1" />
      </svg>
    </span>
  </span>;
}
