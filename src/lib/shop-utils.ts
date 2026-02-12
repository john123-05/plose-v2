import type { ApiError, Photo, UnlockedPhoto } from '../types/shop';

const SPEED_PATH_REGEX = /(\d{4})(?=\.[a-zA-Z0-9]+$)/;

export function parseSpeedFromStoragePath(storagePath?: string | null): number | null {
  if (!storagePath) return null;
  const fileName = storagePath.split('/').pop() ?? '';
  const match = fileName.match(SPEED_PATH_REGEX);
  if (!match) return null;
  const value = Number(match[1]);
  if (Number.isNaN(value)) return null;
  return value / 100;
}

export function photoSpeedKmh(photo: Photo): number | null {
  if (typeof photo.speed_kmh === 'number' && Number.isFinite(photo.speed_kmh)) {
    return photo.speed_kmh;
  }
  return parseSpeedFromStoragePath(photo.storage_path);
}

function toDateKey(input?: string | null): string | null {
  if (!input) return null;
  const maybeDate = input.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(maybeDate)) {
    return maybeDate;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function photoDayKey(photo: Photo): string | null {
  return toDateKey((photo.created_at as string | undefined) ?? (photo.ride_date as string | undefined) ?? null);
}

export function unlockedDayKey(unlockedPhoto: UnlockedPhoto): string | null {
  const candidates: Array<string | null | undefined> = [
    unlockedPhoto.unlock_date,
    unlockedPhoto.ride_date,
    (unlockedPhoto.day as string | undefined) ?? null,
    (unlockedPhoto.date as string | undefined) ?? null,
    unlockedPhoto.unlocked_at,
    unlockedPhoto.created_at,
  ];

  for (const value of candidates) {
    const parsed = toDateKey(value);
    if (parsed) return parsed;
  }
  return null;
}

export function toApiError(error: unknown, fallbackMessage: string): ApiError {
  if (error && typeof error === 'object') {
    const maybeMessage =
      'message' in error && typeof error.message === 'string' ? error.message : fallbackMessage;
    const maybeCode = 'code' in error && typeof error.code === 'string' ? error.code : 'unknown_error';
    return {
      code: maybeCode,
      message: maybeMessage,
      details: error,
    };
  }

  return {
    code: 'unknown_error',
    message: fallbackMessage,
    details: error,
  };
}

export function formatPrice(cents?: number | null, currency = 'EUR'): string {
  const amount = (cents ?? 499) / 100;
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
  }).format(amount);
}
