import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { call } from './api';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** The system's light/dark choice (used when Appearance is Auto). */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(!!media?.matches);
  useEffect(() => {
    if (!media) return;
    const f = () => setDark(media.matches);
    media.addEventListener('change', f);
    f();
    return () => media.removeEventListener('change', f);
  }, []);
  return dark;
}

/**
 * Dark or light, straight from Settings › General › Appearance (Light, Dark or Auto),
 * so switching takes effect at once instead of waiting for a system colour-change event.
 */
export function useDarkMode(): boolean {
  const appearance = useQuery({ queryKey: ['settings'], queryFn: () => call('settings:get'), staleTime: 60_000 }).data?.appearance ?? 'system';
  const system = useSystemDark();
  return appearance === 'dark' ? true : appearance === 'light' ? false : system;
}
