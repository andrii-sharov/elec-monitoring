import type { Device, Invite, Member } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { createInvite, removeMember, revokeInvite } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { queryKeys, useInvites, useMembers } from '@/api/queries';
import { useSession } from '@/api/session';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { storedPhone } from '@/forms/phone/phoneText';
import { applyServerErrors } from '@/forms/zodErrors';
import { useFormatters } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { identifierErrors, identifierValueSchema, toIdentifier } from '../auth/identifier';
import { IdentifierField } from '../auth/IdentifierField';

export const MAX_MEMBERS = 10;

export function DeviceMembers({ device }: { device: Device }) {
  const { t } = useTranslation();
  const isOwner = device.role === 'OWNER';
  const members = useMembers(device.id);
  const invites = useInvites(device.id, { enabled: isOwner });
  const now = useNow(60_000);
  const [link, setLink] = useState<string | null>(null);
  const showLink = (invite: Invite) => setLink(invite.url ?? null);

  const heading = (
    <h2 id="members-title" className="flex items-center gap-2 font-heading text-lg font-medium">
      <Users aria-hidden="true" className="size-4" />
      {t('app.members.title')}
    </h2>
  );

  let body;
  if (members.isPending) {
    body = (
      <output aria-label={t('app.common.loading')}>
        <Skeleton className="h-10" />
      </output>
    );
  } else if (members.error) {
    body = (
      <p role="alert" className="text-danger">
        {errorMessage(t, members.error)}
      </p>
    );
  } else {
    const pending = invites.data?.items ?? [];
    const used =
      members.data.items.filter((m) => m.role === 'VIEWER').length +
      pending.filter((i) => new Date(i.expires_at).getTime() > now).length;
    body = (
      <>
        <MemberList device={device} members={members.data.items} />
        {isOwner ? (
          <>
            <InviteForm deviceId={device.id} full={used >= MAX_MEMBERS} onInvited={showLink} />
            {link ? <InviteLink url={link} /> : null}
            {pending.length > 0 ? (
              <PendingInvites
                deviceId={device.id}
                invites={pending}
                now={now}
                onInvited={showLink}
              />
            ) : null}
          </>
        ) : (
          <LeaveButton device={device} />
        )}
      </>
    );
  }

  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-3">
      {heading}
      {body}
    </section>
  );
}

function MemberList({ device, members }: { device: Device; members: Member[] }) {
  const { t } = useTranslation();
  const { me } = useSession();
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {members.map((member, index) => (
        <li
          key={member.user_id}
          data-motion="enter"
          style={{ '--i': index } as CSSProperties}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
        >
          <span className="font-medium">
            {member.name}
            {member.user_id === me?.id ? ` (${t('app.members.you')})` : null}
          </span>
          <Badge variant="secondary">
            {member.role === 'OWNER' ? t('app.members.owner') : t('app.members.viewer')}
          </Badge>
          {[member.email, member.phone && storedPhone(member.phone)].map((value) =>
            value ? (
              <span key={value} className="text-sm text-muted-foreground">
                {value}
              </span>
            ) : null,
          )}
          {device.role === 'OWNER' && member.role === 'VIEWER' ? (
            <span className="ms-auto">
              <RemoveMember deviceId={device.id} member={member} />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RemoveMember({ deviceId, member }: { deviceId: string; member: Member }) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeMember(api, deviceId, member.user_id),
    onSuccess: () => {
      toast.success(t('app.members.removed', { name: member.name }));
      return queryClient.invalidateQueries({ queryKey: queryKeys.members(deviceId) });
    },
    onError: (error) => toast.error(errorMessage(t, error)),
  });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm" disabled={remove.isPending}>
          {t('app.members.remove', { name: member.name })}
        </Button>
      }
      title={t('app.members.removeTitle', { name: member.name })}
      body={t('app.members.removeBody', { name: member.name })}
      confirmLabel={t('app.members.removeConfirm')}
      destructive
      onConfirm={() => remove.mutate()}
    />
  );
}

const inviteFormSchema = z.object({ identifier: identifierValueSchema });
type InviteInput = z.input<typeof inviteFormSchema>;
type InviteOutput = z.output<typeof inviteFormSchema>;

function useInvitedToast() {
  const { t } = useTranslation();
  return (invite: Invite) =>
    toast.success(
      invite.phone
        ? t('app.members.phoneInviteCreated', { phone: storedPhone(invite.phone) })
        : t('app.members.invited', { email: invite.email }),
    );
}

function InviteForm({
  deviceId,
  full,
  onInvited,
}: {
  deviceId: string;
  full: boolean;
  onInvited: (invite: Invite) => void;
}) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const announce = useInvitedToast();
  const { control, handleSubmit, reset, setError } = useForm<InviteInput, unknown, InviteOutput>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { identifier: '' },
  });
  const send = useMutation({
    mutationFn: ({ identifier }: InviteOutput) =>
      createInvite(api, deviceId, toIdentifier(identifier)),
    onSuccess: (invite) => {
      reset({ identifier: '' });
      announce(invite);
      onInvited(invite);
      return queryClient.invalidateQueries({ queryKey: queryKeys.invites(deviceId) });
    },
    onError: (error) => {
      if (isApiError(error)) {
        applyServerErrors(identifierErrors(error), setError, ['identifier'], t);
      }
    },
  });
  const formError =
    send.error && !(isApiError(send.error) && identifierErrors(send.error).details.length > 0)
      ? errorMessage(t, send.error)
      : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((values) => send.mutate(values))}
    >
      <h3 className="font-medium">{t('app.members.inviteTitle')}</h3>
      <p className="text-sm text-muted-foreground">
        {full ? t('app.members.limit') : t('app.members.inviteHint')}
      </p>
      <FormAlert message={formError} />
      <IdentifierField control={control} name="identifier" autoComplete="off" disabled={full} />
      <Button type="submit" className="self-start" disabled={full || send.isPending}>
        {t('app.members.inviteSubmit')}
      </Button>
    </form>
  );
}

function InviteLink({ url }: { url: string }) {
  const { t } = useTranslation();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('app.members.phoneInviteCopied'));
    } catch {
      toast.error(t('app.members.phoneInviteCopyFailed'));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{t('app.members.phoneInviteHint')}</p>
      <div className="flex gap-2">
        <Input
          readOnly
          value={url}
          aria-label={t('app.members.phoneInviteLink')}
          onFocus={(event) => event.target.select()}
        />
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {t('app.members.phoneInviteCopy')}
        </Button>
      </div>
    </div>
  );
}

function PendingInvites({
  deviceId,
  invites,
  now,
  onInvited,
}: {
  deviceId: string;
  invites: Invite[];
  now: number;
  onInvited: (invite: Invite) => void;
}) {
  const announce = useInvitedToast();
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const format = useFormatters();
  const refetch = () => queryClient.invalidateQueries({ queryKey: queryKeys.invites(deviceId) });
  const resend = useMutation({
    mutationFn: (identifier: string) => createInvite(api, deviceId, toIdentifier(identifier)),
    onSuccess: (invite) => {
      announce(invite);
      onInvited(invite);
      return refetch();
    },
    onError: (error) => toast.error(errorMessage(t, error)),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(api, deviceId, inviteId),
    onSuccess: () => {
      toast.success(t('app.members.revoked'));
      return refetch();
    },
    onError: (error) => toast.error(errorMessage(t, error)),
  });

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{t('app.members.pendingTitle')}</h3>
      <ul className="flex flex-col divide-y rounded-lg border">
        {invites.map((invite, index) => {
          const expired = new Date(invite.expires_at).getTime() <= now;
          return (
            <li
              key={invite.id}
              data-motion="enter"
              style={{ '--i': index } as CSSProperties}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
            >
              <span>{invite.email ?? (invite.phone && storedPhone(invite.phone))}</span>
              {expired ? (
                <Badge variant="outline">{t('app.members.expired')}</Badge>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t('app.members.expires', { moment: format.moment(invite.expires_at) })}
                </span>
              )}
              <span className="ms-auto flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resend.isPending}
                  onClick={() => resend.mutate(invite.email ?? invite.phone ?? '')}
                >
                  {t('app.members.resend')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invite.id)}
                >
                  {t('app.members.revoke')}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LeaveButton({ device }: { device: Device }) {
  const { t } = useTranslation();
  const { api, me } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const leave = useMutation({
    mutationFn: () => removeMember(api, device.id, me!.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.device(device.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      toast.success(t('app.members.left', { device: device.name }));
      void navigate('/devices');
    },
    onError: (error) => toast.error(errorMessage(t, error)),
  });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" className="self-start" disabled={leave.isPending || !me}>
          {t('app.members.leave')}
        </Button>
      }
      title={t('app.members.leaveTitle', { device: device.name })}
      body={t('app.members.leaveBody')}
      confirmLabel={t('app.members.leaveConfirm')}
      destructive
      onConfirm={() => leave.mutate()}
    />
  );
}
