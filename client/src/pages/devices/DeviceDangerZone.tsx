import { RefreshCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { deleteDevice, newPairingCode, rotateToken } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import { useSession } from '@/api/session';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import type { Pairing } from './DeviceSetup';
import { RepairDialog } from './RepairDialog';

export function DeviceDangerZone({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [open, setOpen] = useState(false);
  const [rotated, setRotated] = useState(false);

  const repair = useMutation({
    mutationFn: () => newPairingCode(api, deviceId),
    onSuccess: (next) => {
      setPairing({ code: next.pairing_code, expiresAt: next.pairing_code_expires_at });
      setOpen(true);
    },
  });
  const rotate = useMutation({
    mutationFn: () => rotateToken(api, deviceId),
    onSuccess: () => {
      setRotated(true);
      toast.success(t('app.danger.rotated'));
      void queryClient.invalidateQueries({ queryKey: queryKeys.device(deviceId) });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteDevice(api, deviceId),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.device(deviceId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      void navigate('/devices');
    },
  });
  const startRepair = () => {
    setRotated(false);
    rotate.reset();
    repair.mutate();
  };
  const rotateAndRepair = () => rotate.mutate(undefined, { onSuccess: () => repair.mutate() });
  const failure = repair.error ?? (open ? null : rotate.error) ?? remove.error;

  return (
    <section aria-labelledby="danger-title" className="flex flex-col gap-3">
      <h2
        id="danger-title"
        className="flex items-center gap-2 font-heading text-lg font-medium text-danger"
      >
        <TriangleAlert aria-hidden="true" className="size-4" />
        {t('app.danger.title')}
      </h2>
      <FormAlert message={failure ? errorMessage(t, failure) : null} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={repair.isPending} onClick={startRepair}>
          {t('app.danger.repair')}
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <RefreshCcw aria-hidden="true" />
              {t('app.danger.rotate')}
            </Button>
          }
          title={t('app.danger.rotate')}
          body={t('app.danger.rotateBody')}
          confirmLabel={t('app.danger.rotate')}
          destructive
          onConfirm={rotateAndRepair}
        />
        <ConfirmDialog
          trigger={
            <Button variant="destructive">
              <Trash2 aria-hidden="true" />
              {t('app.danger.delete')}
            </Button>
          }
          title={t('app.danger.deleteTitle')}
          body={t('app.danger.deleteBody')}
          confirmLabel={t('app.danger.delete')}
          destructive
          onConfirm={() => remove.mutate()}
        />
      </div>
      <RepairDialog
        open={open}
        onOpenChange={setOpen}
        pairing={pairing}
        onRenew={() => repair.mutate()}
        rotated={rotated}
        rotating={rotate.isPending}
        rotateError={rotate.error}
        onRotate={() => rotate.mutate()}
      />
    </section>
  );
}
