import { useId } from 'react';

export function NovelCompassMark({ className = '' }: { className?: string }): JSX.Element {
  const id = useId().replace(/:/g, '');
  const backgroundId = `brand-background-${id}`;
  const needleId = `brand-needle-${id}`;
  const shadowId = `brand-shadow-${id}`;

  return (
    <svg
      aria-hidden="true"
      className={`novel-compass-mark ${className}`.trim()}
      focusable="false"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={backgroundId} x1="9" y1="7" x2="55" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a78bfa" />
          <stop offset=".52" stopColor="#765ee8" />
          <stop offset="1" stopColor="#4f3bbd" />
        </linearGradient>
        <linearGradient id={needleId} x1="27" y1="23" x2="38" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff4bd" />
          <stop offset="1" stopColor="#f6c453" />
        </linearGradient>
        <filter id={shadowId} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#21125f" floodOpacity=".4" />
        </filter>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${backgroundId})`} />
      <path
        d="M11 17.5c8-2.1 15.1-.4 21 5 5.9-5.4 13-7.1 21-5v31.8c-7.9-2-15-.3-21 5.2-6-5.5-13.1-7.2-21-5.2V17.5Z"
        fill="#fff"
        fillOpacity=".96"
        filter={`url(#${shadowId})`}
      />
      <path
        d="M32 22.5v32M14.5 21c6.2-1.1 11.2.4 15 4.1M49.5 21c-6.2-1.1-11.2.4-15 4.1"
        fill="none"
        stroke="#d8cffb"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="32" cy="36" r="10.5" fill="#6650cf" stroke="#fff" strokeWidth="2" />
      <circle cx="32" cy="36" r="7.2" fill="#513bb7" />
      <path
        d="m36.8 27.8-2.4 9.7-7.2 6.7 2.4-9.7 7.2-6.7Z"
        fill={`url(#${needleId})`}
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="36" r="1.8" fill="#fff" />
    </svg>
  );
}
