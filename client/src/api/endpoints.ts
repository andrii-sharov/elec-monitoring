import {
  changePasswordBodySchema,
  createInviteBodySchema,
  channelIdsSchema,
  channelListSchema,
  createDeviceBodySchema,
  createDeviceResponseSchema,
  deviceListSchema,
  devicePatchSchema,
  deviceSchema,
  forgotBodySchema,
  invitePreviewSchema,
  inviteSchema,
  invitesSchema,
  loginBodySchema,
  meDeleteSchema,
  mePatchSchema,
  meSchema,
  membersSchema,
  outagesPageSchema,
  pairingCodeSchema,
  putChannelIdsSchema,
  resetBodySchema,
  sessionSchema,
  signupBodySchema,
  telegramLinkSchema,
  telegramUrlSchema,
  tokenBodySchema,
} from '@elec/shared/api';
import type { z } from 'zod';
import type { ApiClient } from './client.ts';

type Body<S extends z.ZodType> = z.input<S>;

const device = (id: string) => `/api/v1/devices/${encodeURIComponent(id)}`;

export function login(api: ApiClient, body: Body<typeof loginBodySchema>) {
  return api.request('/api/auth/login', { method: 'POST', body, schema: sessionSchema });
}

function requestIdentifier(api: ApiClient, path: string, body: object) {
  return api.request(path, {
    method: 'POST',
    body,
    schema: 'phone' in body ? telegramUrlSchema : undefined,
  });
}

export function signup(api: ApiClient, body: Body<typeof signupBodySchema>) {
  return requestIdentifier(api, '/api/auth/signup', body);
}

export function addEmail(api: ApiClient, email: string) {
  return api.request('/api/auth/email', { method: 'POST', body: { email } });
}

export function addPhone(api: ApiClient, phone: string) {
  return api.request('/api/auth/phone', {
    method: 'POST',
    body: { phone },
    schema: telegramUrlSchema,
  });
}

export function verifyEmail(api: ApiClient, body: Body<typeof tokenBodySchema>) {
  return api.request('/api/auth/verify-email', { method: 'POST', body });
}

export function resendVerification(api: ApiClient) {
  return api.request('/api/auth/resend-verification', { method: 'POST' });
}

export function forgotPassword(api: ApiClient, body: Body<typeof forgotBodySchema>) {
  return requestIdentifier(api, '/api/auth/forgot-password', body);
}

export function resetPassword(api: ApiClient, body: Body<typeof resetBodySchema>) {
  return api.request('/api/auth/reset-password', { method: 'POST', body });
}

export function changePassword(api: ApiClient, body: Body<typeof changePasswordBodySchema>) {
  return api.request('/api/auth/change-password', { method: 'POST', body });
}

export function logout(api: ApiClient) {
  return api.request('/api/auth/logout', { method: 'POST' });
}

export function logoutAll(api: ApiClient) {
  return api.request('/api/auth/logout-all', { method: 'POST' });
}

export function unlinkGoogle(api: ApiClient) {
  return api.request('/api/auth/google', { method: 'DELETE' });
}

export function getMe(api: ApiClient) {
  return api.request('/api/v1/me', { schema: meSchema });
}

export function patchMe(api: ApiClient, body: Body<typeof mePatchSchema>) {
  return api.request('/api/v1/me', { method: 'PATCH', body, schema: meSchema });
}

export function deleteMe(api: ApiClient, body: Body<typeof meDeleteSchema>) {
  return api.request('/api/v1/me', { method: 'DELETE', body });
}

export function getDevices(api: ApiClient) {
  return api.request('/api/v1/devices', { schema: deviceListSchema });
}

export function getDevice(api: ApiClient, id: string) {
  return api.request(device(id), { schema: deviceSchema });
}

export function createDevice(api: ApiClient, body: Body<typeof createDeviceBodySchema>) {
  return api.request('/api/v1/devices', {
    method: 'POST',
    body,
    schema: createDeviceResponseSchema,
  });
}

export function patchDevice(api: ApiClient, id: string, body: Body<typeof devicePatchSchema>) {
  return api.request(device(id), { method: 'PATCH', body, schema: deviceSchema });
}

export function deleteDevice(api: ApiClient, id: string) {
  return api.request(device(id), { method: 'DELETE' });
}

export function newPairingCode(api: ApiClient, id: string) {
  return api.request(`${device(id)}/pairing-code`, { method: 'POST', schema: pairingCodeSchema });
}

export function rotateToken(api: ApiClient, id: string) {
  return api.request(`${device(id)}/rotate-token`, { method: 'POST' });
}

export function getOutages(api: ApiClient, id: string, cursor?: string) {
  return api.request(`${device(id)}/outages`, {
    query: { limit: 20, cursor },
    schema: outagesPageSchema,
  });
}

export type OutageRange = { from: string; to: string };

export async function getAllOutages(api: ApiClient, id: string, range: OutageRange) {
  const items = [];
  let cursor: string | undefined;
  do {
    const page = await api.request(`${device(id)}/outages`, {
      query: { ...range, limit: 100, cursor },
      schema: outagesPageSchema,
    });
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return items;
}

export function getChannels(api: ApiClient) {
  return api.request('/api/v1/channels', { schema: channelListSchema });
}

export function createTelegramLink(api: ApiClient) {
  return api.request('/api/v1/channels/telegram-link', {
    method: 'POST',
    schema: telegramLinkSchema,
  });
}

export function deleteChannel(api: ApiClient, id: string) {
  return api.request(`/api/v1/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getDeviceChannels(api: ApiClient, id: string) {
  return api.request(`${device(id)}/channels`, { schema: channelIdsSchema });
}

export function putDeviceChannels(
  api: ApiClient,
  id: string,
  body: Body<typeof putChannelIdsSchema>,
) {
  return api.request(`${device(id)}/channels`, { method: 'PUT', body, schema: channelIdsSchema });
}

export function getMembers(api: ApiClient, id: string) {
  return api.request(`${device(id)}/members`, { schema: membersSchema });
}

export function removeMember(api: ApiClient, id: string, userId: string) {
  return api.request(`${device(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export function getInvites(api: ApiClient, id: string) {
  return api.request(`${device(id)}/invites`, { schema: invitesSchema });
}

export function createInvite(
  api: ApiClient,
  id: string,
  body: Body<typeof createInviteBodySchema>,
) {
  return api.request(`${device(id)}/invites`, { method: 'POST', body, schema: inviteSchema });
}

export function revokeInvite(api: ApiClient, id: string, inviteId: string) {
  return api.request(`${device(id)}/invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
  });
}

export function getInvitePreview(api: ApiClient, token: string) {
  return api.request(`/api/v1/invites/${encodeURIComponent(token)}`, {
    schema: invitePreviewSchema,
  });
}

export function acceptInvite(api: ApiClient, token: string) {
  return api.request(`/api/v1/invites/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    schema: deviceSchema,
  });
}
