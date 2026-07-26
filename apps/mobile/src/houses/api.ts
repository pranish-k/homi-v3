import { apiGet, apiPost } from '@/api/client';

/** HOMI-32: house creation and invite joining, the app's entry into a house. */

export interface HouseSummary {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  role: string;
  joinedAt: string;
}

export interface InvitePreview {
  houseId: string;
  houseName: string;
  invitedByName: string;
  expiresAt: string;
  /** Set when the invite claims a placeholder's history ("join as Sam"). */
  placeholderName: string | null;
}

export interface AcceptedInvite {
  houseId: string;
  alreadyMember?: boolean;
  claimedPlaceholderId?: string | null;
}

export interface CreatedInvite {
  url: string;
  expiresAt: string;
}

export const listHouses = () => apiGet<HouseSummary[]>('/v1/houses');

export const createHouse = (name: string, timezone: string) =>
  apiPost<HouseSummary>('/v1/houses', { name, timezone, currency: 'USD' });

export const previewInvite = (token: string) =>
  apiGet<InvitePreview>(`/v1/invites/${encodeURIComponent(token)}`);

export const acceptInvite = (token: string) =>
  apiPost<AcceptedInvite>(`/v1/invites/${encodeURIComponent(token)}/accept`);

export const createInvite = (houseId: string) =>
  apiPost<CreatedInvite>(`/v1/houses/${houseId}/invites`);
