import { RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PairingCode } from '@/components/PairingCode';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import type { Pairing } from './DeviceSetup';

type RepairDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pairing: Pairing | null;
  onRenew: () => void;
  rotated: boolean;
  rotating: boolean;
  rotateError: Error | null;
  onRotate: () => void;
};

export function RepairDialog({
  open,
  onOpenChange,
  pairing,
  onRenew,
  rotated,
  rotating,
  rotateError,
  onRotate,
}: RepairDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('app.danger.repairTitle')}</DialogTitle>
          <DialogDescription>{t('app.danger.repairBody')}</DialogDescription>
        </DialogHeader>
        {pairing ? (
          <PairingCode code={pairing.code} expiresAt={pairing.expiresAt} onRenew={onRenew} />
        ) : null}
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          {rotated ? null : <li>{t('app.danger.repairStepSetup')}</li>}
          <li>{t('app.danger.repairStepJoin')}</li>
        </ol>
        {rotated ? (
          <output className="text-sm font-medium">{t('app.danger.rotated')}</output>
        ) : (
          <div className="flex flex-col items-start gap-2 border-t border-border pt-3">
            <h3 className="text-sm font-medium">{t('app.danger.disconnectTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('app.danger.disconnectBody')}</p>
            <FormAlert message={rotateError ? errorMessage(t, rotateError) : null} />
            <Button variant="outline" size="sm" disabled={rotating} onClick={onRotate}>
              <RefreshCcw aria-hidden="true" />
              {t('app.danger.rotate')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
