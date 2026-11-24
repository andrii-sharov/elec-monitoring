import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useFormatters } from '@/lib/format';
import { useSecondsLeft } from '@/lib/useCountdown';

type PairingCodeProps = { code: string; expiresAt: string; onRenew: () => void };

export function PairingCode({ code, expiresAt, onRenew }: PairingCodeProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  const secondsLeft = useSecondsLeft(expiresAt);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  useEffect(() => {
    if (copiedCode === null) return;
    const id = setTimeout(() => setCopiedCode(null), 1500);
    return () => clearTimeout(id);
  }, [copiedCode]);

  if (secondsLeft === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{t('app.addDevice.expired')}</p>
        <Button onClick={onRenew}>{t('app.addDevice.renew')}</Button>
      </div>
    );
  }

  const copied = copiedCode === code;
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <p
        aria-label={t('app.addDevice.codeTitle')}
        className="font-mono text-3xl font-semibold tracking-widest"
      >
        {code.match(/.{1,4}/g)?.join(' ')}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('app.addDevice.expiresIn', { time: format.duration(secondsLeft) })}
      </p>
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? t('app.addDevice.copied') : t('app.addDevice.copy')}
      </Button>
    </div>
  );
}
