import type { Client } from '../../../shared/types';

export const CLIENT_EXPORT_HEADERS = [
  'İsim',
  'E-posta',
  'Durum',
  'Hedef',
  'Diyet Süresi',
  'Güncel Kilo (kg)',
  'Haftalık Değişim (kg)',
  'Uyum - Son 7 Gün (%)',
] as const;

export type ClientExportCell = string | number | null;

const normalizeNullableNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(',', '.');
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)(?:\s*kg)?$/i);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const numericOrBlank = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export const mapClientsToExportRows = (
  clients: readonly Client[],
): ClientExportCell[][] => clients.map((client) => [
  client.name || null,
  client.email || null,
  client.status || null,
  client.goal || null,
  client.duration,
  normalizeNullableNumber(client.currentWeight),
  numericOrBlank(client.weeklyChange),
  numericOrBlank(client.compliance),
]);
