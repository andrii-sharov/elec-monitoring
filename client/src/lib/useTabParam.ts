import { useSearchParams } from 'react-router';

export function useTabParam<T extends string>(choices: readonly T[], fallback: T) {
  const [params, setParams] = useSearchParams();
  const tab = choices.find((choice) => choice === params.get('tab')) ?? fallback;
  const select = (value: T) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === fallback) next.delete('tab');
        else next.set('tab', value);
        return next;
      },
      { replace: true },
    );
  return [tab, select] as const;
}
