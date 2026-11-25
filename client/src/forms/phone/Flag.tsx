import { useEffect, useState } from 'react';

type Flags = Partial<Record<string, string>>;

let loaded: Flags | null = null;
let loading: Promise<Flags> | null = null;

function loadFlags(): Promise<Flags> {
  loading ??= import('country-flag-icons/string/3x2').then((module) => {
    loaded = module as Flags;
    return loaded;
  });
  return loading;
}

function useFlags(): Flags | null {
  const [flags, setFlags] = useState(loaded);
  useEffect(() => {
    if (flags) return;
    let active = true;
    void loadFlags().then((next) => {
      if (active) setFlags(next);
    });
    return () => {
      active = false;
    };
  }, [flags]);
  return flags;
}

export function Flag({ code }: { code: string }) {
  const svg = useFlags()?.[code];
  const className = 'h-3.5 w-5 shrink-0 rounded-[2px] bg-muted object-cover';
  if (!svg) return <span aria-hidden className={className} />;
  return (
    <img
      alt=""
      className={className}
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
    />
  );
}
