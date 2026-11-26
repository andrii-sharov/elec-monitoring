import { cn } from '@/lib/utils';
import channelsEmpty from '../../../assets/illustrations/channels-empty.svg?raw';
import historyEmpty from '../../../assets/illustrations/history-empty.svg?raw';
import notFound from '../../../assets/illustrations/not-found.svg?raw';

const sources = { channelsEmpty, historyEmpty, notFound };

export type IllustrationName = keyof typeof sources;

export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-illustration={name}
      className={cn('block w-48 [&>svg]:h-auto [&>svg]:w-full', className)}
      dangerouslySetInnerHTML={{ __html: sources[name] }}
    />
  );
}

export function EmptyState({
  illustration,
  children,
  className,
}: {
  illustration: IllustrationName;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-motion="enter"
      className={cn(
        'flex flex-col items-center gap-3 py-6 text-center text-muted-foreground',
        className,
      )}
    >
      <Illustration name={illustration} className="w-40" />
      {children}
    </div>
  );
}
