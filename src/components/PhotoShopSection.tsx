import type { User } from '@supabase/supabase-js';
import {
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  CreditCard,
  Download,
  Facebook,
  Gauge,
  Heart,
  Instagram,
  Loader2,
  LogOut,
  Mail,
  Medal,
  Music2,
  RefreshCw,
  Share2,
  ShieldAlert,
  ShoppingBag,
  ShoppingCart,
  Twitter,
  Trash2,
  UserCircle2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { formatPrice, photoDayKey, photoSpeedKmh, toApiError, unlockedDayKey } from '../lib/shop-utils';
import { createEphemeralSupabaseClient, supabase, supabaseConfigError, supabasePublicUrl } from '../lib/supabase';
import type {
  ApiError,
  CartItem,
  CheckoutRequest,
  CheckoutResponse,
  DeleteAccountRequest,
  DeleteAccountResponse,
  LeaderboardEntry,
  NewsletterSubscription,
  Photo,
  Purchase,
  Ride,
  UiState,
  UnlockedPhoto,
  UserProfile,
} from '../types/shop';

type AuthMode = 'login' | 'signup';
type SettingsPanel = 'account' | 'profile' | 'newsletter' | 'delete';

const PLOSE_PARK_ID = '3b08e092-beb5-46ec-9811-5698e86dd83a';
const PLOSE_PARK_NAME = 'Plose';
const PLOSE_TIMEZONE = 'Europe/Rome';
const PLOSE_AVATAR_BUCKET =
  (import.meta.env.VITE_PLOSE_AVATAR_BUCKET as string | undefined)?.trim() || 'avatars';
const GUEST_PREVIEW_CACHE_KEY = 'plose_guest_preview_photos_v1';
const GUEST_LEADERBOARD_CACHE_KEY = 'plose_guest_leaderboard_v1';
const DAY_PASS_PRICE_CENTS = 1499;

function dayPassStorageKey(userId: string): string {
  return `plose_day_pass_cart_${PLOSE_PARK_ID}_${userId}`;
}

function pendingCheckoutStorageKey(userId: string): string {
  return `plose_pending_checkout_${PLOSE_PARK_ID}_${userId}`;
}

type MessageState = {
  state: UiState;
  message: string | null;
  error: ApiError | null;
};

function initialMessageState(): MessageState {
  return {
    state: 'idle',
    message: null,
    error: null,
  };
}

function toDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const maybeDate = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(maybeDate)) {
    return maybeDate;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

function rideDateKey(ride: Ride): string | null {
  return toDateKey((ride.ride_date as string | undefined) ?? (ride.created_at as string | undefined) ?? null);
}

function normalizeToAbsoluteUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (!supabasePublicUrl) return value;
  if (value.startsWith('/')) return `${supabasePublicUrl}${value}`;
  if (value.startsWith('storage/v1/')) return `${supabasePublicUrl}/${value}`;
  return value;
}

function directPhotoUrl(photo: Photo): string | null {
  const raw =
    (photo.image_url as string | undefined) ??
    (photo.thumbnail_url as string | undefined) ??
    (photo.url as string | undefined) ??
    null;
  return normalizeToAbsoluteUrl(raw);
}

function resolvePhotoUrl(photo: Photo, resolvedUrl?: string | null): string | null {
  if (resolvedUrl) return resolvedUrl;
  const direct = directPhotoUrl(photo);
  if (direct) return direct;

  const path = photo.storage_path;
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  return null;
}

function resolveAvatarUrlValue(value: string | null | undefined): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  const normalized = normalizeToAbsoluteUrl(raw);
  if (normalized && (normalized.startsWith('http://') || normalized.startsWith('https://'))) {
    return normalized;
  }

  if (!supabase) return normalized ?? raw;

  let storageRef = extractStorageRef({
    id: 'avatar-ref',
    storage_path: raw,
  } as Photo);
  if (!storageRef) {
    const normalizedPath = raw.replace(/^\/+/, '');
    if (normalizedPath && !normalizedPath.includes('://') && !normalizedPath.startsWith('storage/v1/')) {
      storageRef = {
        bucket: PLOSE_AVATAR_BUCKET,
        objectPath: normalizedPath,
      };
    }
  }
  if (!storageRef) return normalized ?? raw;

  const publicUrl = supabase.storage.from(storageRef.bucket).getPublicUrl(storageRef.objectPath).data.publicUrl;
  return normalizeToAbsoluteUrl(publicUrl) ?? publicUrl ?? normalized ?? raw;
}

type StorageRef = {
  bucket: string;
  objectPath: string;
};

function extractStorageRef(photo: Photo): StorageRef | null {
  const rawPath = typeof photo.storage_path === 'string' ? photo.storage_path.trim() : '';
  if (!rawPath) return null;

  const explicitBucket = typeof photo.storage_bucket === 'string' ? photo.storage_bucket.trim() : '';

  // Some backends store complete signed/public storage URLs in storage_path.
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    const match = rawPath.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/?#]+)\/(.+?)(?:\?|$)/i);
    if (!match) return null;
    const bucket = decodeURIComponent(match[1] ?? '').trim();
    const objectPath = decodeURIComponent(match[2] ?? '').trim();
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  let normalizedPath = rawPath.replace(/^\/+/, '');
  if (explicitBucket) {
    const prefix = `${explicitBucket}/`;
    if (normalizedPath.startsWith(prefix)) {
      normalizedPath = normalizedPath.slice(prefix.length);
    }
    if (!normalizedPath) return null;
    return { bucket: explicitBucket, objectPath: normalizedPath };
  }

  const parts = normalizedPath.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  return {
    bucket: parts[0],
    objectPath: parts.slice(1).join('/'),
  };
}

function isDuplicateInsertError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message =
    'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('duplicate') || message.includes('unique');
}

function isPloseParkRow(row: { park_id?: unknown }): boolean {
  const parkId = typeof row.park_id === 'string' ? row.park_id : null;
  if (!parkId) return true;
  return parkId === PLOSE_PARK_ID;
}

function normalizePersonName(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function splitDisplayNameIntoNameParts(displayName: string): { vorname: string | null; nachname: string | null } {
  const normalized = normalizePersonName(displayName);
  if (!normalized) {
    return { vorname: null, nachname: null };
  }

  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return { vorname: parts[0], nachname: null };
  }

  return {
    vorname: parts[0],
    nachname: parts.slice(1).join(' '),
  };
}

function resolveProfileDisplayName(row: Partial<UserProfile> | null | undefined): string {
  if (!row) return '';

  const displayName = normalizePersonName(row.display_name);
  if (displayName) return displayName;

  const firstName = normalizePersonName(row.vorname);
  const lastName = normalizePersonName(row.nachname);
  return `${firstName} ${lastName}`.trim();
}

function toLocalDateInputValue(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePhotoForShop(photo: Photo, demoPriceId: string): Photo {
  const normalized: Photo = { ...photo };

  // Force unified storefront price to EUR 4.99 for all photos in this UI.
  normalized.price_cents = 499;

  if (demoPriceId) {
    const existingPriceId =
      (normalized.price_id as string | undefined) ??
      (normalized.stripe_price_id as string | undefined) ??
      (normalized.stripePriceId as string | undefined);

    if (!existingPriceId) {
      normalized.price_id = demoPriceId;
      normalized.stripe_price_id = demoPriceId;
      normalized.stripePriceId = demoPriceId;
    }
  }

  return normalized;
}

async function getFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (!error || typeof error !== 'object') return fallback;

  const err = error as { message?: unknown; context?: unknown };
  const baseMessage = typeof err.message === 'string' && err.message ? err.message : fallback;

  const context = err.context as
    | { status?: number; statusText?: string; clone?: () => Response; text?: () => Promise<string> }
    | undefined;

  if (!context) return baseMessage;

  const statusPrefix =
    typeof context.status === 'number'
      ? `HTTP ${context.status}${context.statusText ? ` ${context.statusText}` : ''}: `
      : '';

  try {
    const responseLike = typeof context.clone === 'function' ? context.clone() : context;
    if (typeof responseLike.text === 'function') {
      const raw = (await responseLike.text()).trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { error?: string; message?: string };
          const apiMessage = parsed.error || parsed.message || raw;
          return `${statusPrefix}${apiMessage}`;
        } catch {
          return `${statusPrefix}${raw}`;
        }
      }
    }
  } catch {
    return `${statusPrefix}${baseMessage}`;
  }

  return `${statusPrefix}${baseMessage}`;
}

export function PhotoShopSection() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authState, setAuthState] = useState<MessageState>(initialMessageState());
  const [loginAttention, setLoginAttention] = useState(false);
  const [loginAttentionMessage, setLoginAttentionMessage] = useState<string | null>(null);
  const loginBoxRef = useRef<HTMLDivElement | null>(null);
  const loginAttentionTimerRef = useRef<number | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const leaderboardSyncKeyRef = useRef<string>('');
  const leaderboardProfileColumnsRef = useRef<boolean | null>(null);
  const promoPopupHideTimerRef = useRef<number | null>(null);
  const promoPopupEnterTimerRef = useRef<number | null>(null);
  const newsletterPromptedUserRef = useRef<string | null>(null);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel | null>(null);
  const [shareMenuPhoto, setShareMenuPhoto] = useState<Photo | null>(null);
  const [expandedPurchasedPhoto, setExpandedPurchasedPhoto] = useState<Photo | null>(null);
  const [promoPopup, setPromoPopup] = useState<'favorite_expiry' | 'newsletter' | null>(null);
  const [promoPopupVisible, setPromoPopupVisible] = useState(false);
  const [newsletterPopupSubmitting, setNewsletterPopupSubmitting] = useState(false);
  const [newsletterPopupThanks, setNewsletterPopupThanks] = useState(false);
  const gallerySectionRef = useRef<HTMLDivElement | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileState, setProfileState] = useState<MessageState>(initialMessageState());
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedRideId, setSelectedRideId] = useState<string>('');
  const [showGalleryFilters, setShowGalleryFilters] = useState(false);
  const [showAllGalleryPhotos, setShowAllGalleryPhotos] = useState(false);
  const [rides, setRides] = useState<Ride[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [galleryState, setGalleryState] = useState<MessageState>(initialMessageState());

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritePhotos, setFavoritePhotos] = useState<Photo[]>([]);
  const [favoritesState, setFavoritesState] = useState<MessageState>(initialMessageState());
  const [favoritePhotosState, setFavoritePhotosState] = useState<MessageState>(initialMessageState());

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [dayPassInCart, setDayPassInCart] = useState(false);
  const [cartState, setCartState] = useState<MessageState>(initialMessageState());
  const [checkoutState, setCheckoutState] = useState<MessageState>(initialMessageState());

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [unlockedPhotos, setUnlockedPhotos] = useState<UnlockedPhoto[]>([]);
  const [purchasedPhotos, setPurchasedPhotos] = useState<Photo[]>([]);
  const [resolvedPhotoUrls, setResolvedPhotoUrls] = useState<Record<string, string>>({});
  const [failedPhotoUrlById, setFailedPhotoUrlById] = useState<Record<string, string>>({});

  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardState, setLeaderboardState] = useState<MessageState>(initialMessageState());

  const [newsletter, setNewsletter] = useState<NewsletterSubscription | null>(null);
  const [newsletterState, setNewsletterState] = useState<MessageState>(initialMessageState());

  const [deleteEmailConfirm, setDeleteEmailConfirm] = useState('');
  const [deleteOtp, setDeleteOtp] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteOtpVerified, setDeleteOtpVerified] = useState(false);
  const [deleteState, setDeleteState] = useState<MessageState>(initialMessageState());
  const stripeDemoPriceId = (import.meta.env.VITE_STRIPE_DEMO_PRICE_ID as string | undefined)?.trim() || '';
  const guestPreviewBucket =
    (import.meta.env.VITE_PLOSE_GALLERY_BUCKET as string | undefined)?.trim() ||
    (import.meta.env.VITE_GALLERY_BUCKET as string | undefined)?.trim() ||
    '';

  const promptLoginToUseFeature = useCallback((message = 'Login to use this.') => {
    setLoginAttentionMessage(message);
    setLoginAttention(true);
    setAuthMode('login');

    if (loginAttentionTimerRef.current) {
      window.clearTimeout(loginAttentionTimerRef.current);
    }

    loginAttentionTimerRef.current = window.setTimeout(() => {
      setLoginAttention(false);
    }, 1600);

    loginBoxRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, []);

  const openSettingsPanel = useCallback((panel: SettingsPanel) => {
    setActiveSettingsPanel(panel);
    setShowSettingsDropdown(false);
    loginBoxRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, []);

  const openGalleryAndDashboard = useCallback(() => {
    setActiveSettingsPanel(null);
    setShowSettingsDropdown(false);

    window.setTimeout(() => {
      gallerySectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 0);
  }, []);

  const popupEnabled = newsletter?.popup_enabled ?? profile?.popup_enabled ?? true;

  const closePromoPopup = useCallback(() => {
    if (promoPopupEnterTimerRef.current) {
      window.clearTimeout(promoPopupEnterTimerRef.current);
      promoPopupEnterTimerRef.current = null;
    }
    if (promoPopupHideTimerRef.current) {
      window.clearTimeout(promoPopupHideTimerRef.current);
      promoPopupHideTimerRef.current = null;
    }
    setPromoPopupVisible(false);
    promoPopupHideTimerRef.current = window.setTimeout(() => {
      setPromoPopup(null);
      setNewsletterPopupThanks(false);
    }, 220);
  }, []);

  const openPromoPopup = useCallback(
    (kind: 'favorite_expiry' | 'newsletter') => {
      if (!popupEnabled) return;
      if (promoPopupHideTimerRef.current) {
        window.clearTimeout(promoPopupHideTimerRef.current);
        promoPopupHideTimerRef.current = null;
      }
      if (promoPopupEnterTimerRef.current) {
        window.clearTimeout(promoPopupEnterTimerRef.current);
        promoPopupEnterTimerRef.current = null;
      }
      setPromoPopup(kind);
      setNewsletterPopupThanks(false);
      setPromoPopupVisible(false);
      promoPopupEnterTimerRef.current = window.setTimeout(() => {
        setPromoPopupVisible(true);
      }, 20);
    },
    [popupEnabled]
  );

  const resetUserData = useCallback(() => {
    setProfile(null);
    setProfileDisplayName('');
    setProfileAvatarUrl('');
    setNewPassword('');
    setFavorites(new Set());
    setFavoritePhotos([]);
    setCartItems([]);
    setDayPassInCart(false);
    setPurchases([]);
    setUnlockedPhotos([]);
    setPurchasedPhotos([]);
    setResolvedPhotoUrls({});
    setFailedPhotoUrlById({});
    setNewsletter(null);
    setDeleteEmailConfirm('');
    setDeleteOtp('');
    setDeleteReason('');
    setDeletePhrase('');
    setDeleteOtpVerified(false);
    setSelectedDate('');
    setSelectedTime('');
    setSelectedRideId('');
    setShowGalleryFilters(false);
    setShowAllGalleryPhotos(false);
    setShowSettingsDropdown(false);
    setActiveSettingsPanel(null);
    setPromoPopup(null);
    setPromoPopupVisible(false);
    setNewsletterPopupSubmitting(false);
    setNewsletterPopupThanks(false);
    newsletterPromptedUserRef.current = null;
    setFavoritePhotosState(initialMessageState());
  }, []);

  useEffect(() => {
    return () => {
      if (loginAttentionTimerRef.current) {
        window.clearTimeout(loginAttentionTimerRef.current);
      }
      if (promoPopupEnterTimerRef.current) {
        window.clearTimeout(promoPopupEnterTimerRef.current);
      }
      if (promoPopupHideTimerRef.current) {
        window.clearTimeout(promoPopupHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (popupEnabled) return;
    closePromoPopup();
  }, [closePromoPopup, popupEnabled]);

  useEffect(() => {
    if (promoPopup !== 'newsletter') return;
    if (!newsletter?.subscribed) return;
    closePromoPopup();
  }, [closePromoPopup, newsletter?.subscribed, promoPopup]);

  const upsertPloseUserAssignment = useCallback(async (user: User): Promise<ApiError | null> => {
    if (!supabase) {
      return { code: 'supabase_missing', message: 'Supabase ist nicht konfiguriert.' };
    }

    const payload = {
      id: user.id,
      email: user.email ?? null,
      park_id: PLOSE_PARK_ID,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('users').upsert(payload, { onConflict: 'id' });
    if (error) {
      return toApiError(error, 'Park-Zuordnung konnte nicht gespeichert werden.');
    }

    return null;
  }, []);

  const validatePloseAccessOnLogin = useCallback(
    async (user: User): Promise<ApiError | null> => {
      if (!supabase) {
        return { code: 'supabase_missing', message: 'Supabase ist nicht konfiguriert.' };
      }

      const { data, error, status } = await supabase
        .from('users')
        .select('id, park_id')
        .eq('id', user.id)
        .maybeSingle();

      if (error && status !== 406) {
        return toApiError(error, 'Park-Zuordnung konnte nicht geprüft werden.');
      }

      const row = (data as { id: string; park_id: string | null } | null) ?? null;
      if (row?.park_id && row.park_id !== PLOSE_PARK_ID) {
        return {
          code: 'park_mismatch',
          message: 'Dieses Konto gehört zu einem anderen Park und kann hier nicht genutzt werden.',
          details: { current_park_id: row.park_id, expected_park_id: PLOSE_PARK_ID },
        };
      }

      if (!row || !row.park_id) {
        return upsertPloseUserAssignment(user);
      }

      return null;
    },
    [upsertPloseUserAssignment]
  );

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setCurrentUser(data.session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadRides = useCallback(async () => {
    if (!supabase) return;

    setGalleryState({ state: 'loading', message: null, error: null });
    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .eq('park_id', PLOSE_PARK_ID)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      setGalleryState({
        state: 'error',
        message: null,
        error: toApiError(error, 'Rides konnten nicht geladen werden.'),
      });
      return;
    }

    const mapped = (data ?? []) as Ride[];
    const ridesForPlose = mapped.filter((ride) => isPloseParkRow(ride));
    const byDate = ridesForPlose.filter((ride) => {
      if (!selectedDate) return true;
      return rideDateKey(ride) === selectedDate;
    });

    setRides(byDate);
    setSelectedRideId('');

    if (selectedDate && byDate.length === 0) {
      setGalleryState({ state: 'success', message: 'Keine Fahrten für dieses Datum.', error: null });
    } else {
      setGalleryState({ state: 'success', message: null, error: null });
    }
  }, [selectedDate]);

  const loadPhotos = useCallback(async () => {
    if (!supabase) return;
    const sb = supabase;

    setGalleryState({ state: 'loading', message: null, error: null });

    const loadGuestPreviewViaBucket = async (): Promise<Photo[] | null> => {
      const bucketCandidates: string[] = [];
      if (guestPreviewBucket) bucketCandidates.push(guestPreviewBucket);

      const { data: mappedBuckets } = await sb
        .from('park_storage_buckets')
        .select('bucket_id')
        .eq('park_id', PLOSE_PARK_ID)
        .limit(5);

      for (const row of mappedBuckets ?? []) {
        const bucketId = typeof row.bucket_id === 'string' ? row.bucket_id.trim() : '';
        if (bucketId) bucketCandidates.push(bucketId);
      }

      bucketCandidates.push('plose', 'plosebob', 'photos', 'photo', 'bilder');
      const uniqueBucketCandidates = [...new Set(bucketCandidates.filter(Boolean))];
      if (uniqueBucketCandidates.length === 0) return null;

      const isImageName = (fileName: string) => /\.(?:jpe?g|png|webp|gif|avif)$/i.test(fileName);
      const toTimestamp = (value?: string | null) => {
        if (!value) return 0;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      type BucketPreviewObject = {
        objectPath: string;
        createdAt: string | null;
      };

      for (const bucket of uniqueBucketCandidates) {
        const { data: rootEntries, error: rootListError } = await sb.storage.from(bucket).list('', {
          limit: 120,
          sortBy: { column: 'updated_at', order: 'desc' },
        });

        if (rootListError || !rootEntries) continue;

        const objectCandidates: BucketPreviewObject[] = [];
        const subdirectories: string[] = [];

        for (const entry of rootEntries) {
          const name = typeof entry.name === 'string' ? entry.name.trim() : '';
          if (!name) continue;

          const looksLikeImage = isImageName(name);
          if (looksLikeImage) {
            objectCandidates.push({
              objectPath: name,
              createdAt: entry.created_at ?? entry.updated_at ?? null,
            });
            continue;
          }

          // Folder entries usually have no image extension and can contain nested files.
          if (!name.includes('.')) {
            subdirectories.push(name);
          }
        }

        for (const dir of subdirectories.slice(0, 10)) {
          const { data: nestedEntries, error: nestedListError } = await sb.storage.from(bucket).list(dir, {
            limit: 80,
            sortBy: { column: 'updated_at', order: 'desc' },
          });

          if (nestedListError || !nestedEntries) continue;

          for (const entry of nestedEntries) {
            const fileName = typeof entry.name === 'string' ? entry.name.trim() : '';
            if (!fileName || !isImageName(fileName)) continue;
            objectCandidates.push({
              objectPath: `${dir}/${fileName}`,
              createdAt: entry.created_at ?? entry.updated_at ?? null,
            });
          }
        }

        if (objectCandidates.length === 0) continue;

        objectCandidates.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
        const latest = objectCandidates.slice(0, 3);
        const objectPaths = latest.map((entry) => entry.objectPath);
        const urlByPath = new Map<string, string>();

        const { data: signedRows } = await sb.storage.from(bucket).createSignedUrls(objectPaths, 60 * 60);
        if (Array.isArray(signedRows)) {
          for (const row of signedRows) {
            const path = typeof row?.path === 'string' ? row.path : '';
            const signedUrl = typeof row?.signedUrl === 'string' ? row.signedUrl : '';
            if (path && signedUrl) {
              urlByPath.set(path, normalizeToAbsoluteUrl(signedUrl) ?? signedUrl);
            }
          }
        }

        const previewPhotos: Photo[] = latest.map((entry, index) => {
          const publicUrl = sb.storage.from(bucket).getPublicUrl(entry.objectPath).data.publicUrl;
          const resolvedUrl =
            urlByPath.get(entry.objectPath) ??
            normalizeToAbsoluteUrl(publicUrl) ??
            publicUrl;

          return normalizePhotoForShop(
            {
              id: `preview-${bucket}-${index}-${entry.objectPath}`,
              park_id: PLOSE_PARK_ID,
              storage_bucket: bucket,
              storage_path: entry.objectPath,
              image_url: resolvedUrl,
              thumbnail_url: resolvedUrl,
              created_at: entry.createdAt,
            } as Photo,
            stripeDemoPriceId
          );
        });

        if (previewPhotos.length > 0) {
          return previewPhotos;
        }
      }

      return null;
    };

    const loadGuestPreviewViaAnonAuth = async (): Promise<Photo[] | null> => {
      const guestClient = createEphemeralSupabaseClient();
      if (!guestClient) return null;

      const { error: signInError } = await guestClient.auth.signInAnonymously();
      if (signInError) return null;

      const { data: guestPhotos, error: guestPhotosError } = await guestClient
        .from('photos')
        .select('*')
        .eq('park_id', PLOSE_PARK_ID)
        .order('created_at', { ascending: false })
        .limit(3);

      if (guestPhotosError) return null;

      return (guestPhotos ?? []) as Photo[];
    };

    const loadGuestPreviewFromCache = (): Photo[] | null => {
      if (typeof window === 'undefined') return null;
      try {
        const raw = window.localStorage.getItem(GUEST_PREVIEW_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        const valid = parsed
          .filter((row): row is Photo => Boolean(row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string'))
          .slice(0, 3)
          .map((row) => normalizePhotoForShop(row, stripeDemoPriceId));
        return valid.length > 0 ? valid : null;
      } catch {
        return null;
      }
    };

    const loadGuestPreviewFallback = async (): Promise<Photo[] | null> => {
      const fromBucket = await loadGuestPreviewViaBucket();
      if (fromBucket && fromBucket.length > 0) return fromBucket;
      const fromAnonAuth = await loadGuestPreviewViaAnonAuth();
      if (fromAnonAuth && fromAnonAuth.length > 0) return fromAnonAuth;
      return loadGuestPreviewFromCache();
    };

    let query = sb
      .from('photos')
      .select('*')
      .eq('park_id', PLOSE_PARK_ID)
      .order('created_at', { ascending: false })
      .limit(currentUser ? 400 : 3);

    if (currentUser && selectedDate) {
      if (!selectedTime) {
        setPhotos([]);
        setGalleryState({
          state: 'error',
          message: null,
          error: {
            code: 'time_required',
            message: 'Bitte eine Uhrzeit wählen. Es werden die letzten 7 Minuten bis zu dieser Zeit geladen.',
          },
        });
        return;
      }

      const dayStart = new Date(`${selectedDate}T00:00:00.000`);
      const rangeEnd = new Date(`${selectedDate}T${selectedTime}:59.999`);

      if (Number.isNaN(rangeEnd.getTime())) {
        setPhotos([]);
        setGalleryState({
          state: 'error',
          message: null,
          error: {
            code: 'invalid_time',
            message: 'Ungültige Uhrzeit. Bitte Zeit neu eingeben.',
          },
        });
        return;
      }

      const computedStart = new Date(rangeEnd.getTime() - 7 * 60 * 1000);
      const rangeStart = computedStart < dayStart ? dayStart : computedStart;

      query = query.gte('created_at', rangeStart.toISOString()).lte('created_at', rangeEnd.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      if (!currentUser) {
        const guestPhotos = await loadGuestPreviewFallback();
        if (guestPhotos && guestPhotos.length > 0) {
          setPhotos(
            guestPhotos
              .filter((photo) => isPloseParkRow(photo))
              .map((photo) => normalizePhotoForShop(photo, stripeDemoPriceId))
          );
          setGalleryState({ state: 'success', message: null, error: null });
          return;
        }
      }

      setGalleryState({
        state: 'error',
        message: null,
        error: toApiError(
          error,
          'Fotos konnten nicht geladen werden. Öffentlicher Preview-Zugriff ist aktuell nicht verfügbar.'
        ),
      });
      return;
    }

    let mapped = ((data ?? []) as Photo[])
      .filter((photo) => isPloseParkRow(photo))
      .map((photo) => normalizePhotoForShop(photo, stripeDemoPriceId));

    // Some backends use differing DB types for rides/photos relation; filter in-memory to avoid 400 type issues.
    if (currentUser && selectedRideId) {
      mapped = mapped.filter((photo) => String(photo.ride_id ?? '') === String(selectedRideId));
    }

    if (!currentUser && mapped.length === 0) {
      const guestPhotos = await loadGuestPreviewFallback();
      if (guestPhotos && guestPhotos.length > 0) {
        mapped = guestPhotos
          .filter((photo) => isPloseParkRow(photo))
          .map((photo) => normalizePhotoForShop(photo, stripeDemoPriceId));
      }
    }

    setPhotos(mapped);
    setGalleryState({ state: 'success', message: null, error: null });
  }, [currentUser, guestPreviewBucket, selectedDate, selectedRideId, selectedTime, stripeDemoPriceId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (photos.length === 0) return;

    const cacheRows = photos.slice(0, 3).map((photo) => {
      const resolvedUrl = resolvePhotoUrl(photo, resolvedPhotoUrls[photo.id]);
      return {
        ...photo,
        image_url: resolvedUrl ?? photo.image_url ?? null,
        thumbnail_url: resolvedUrl ?? photo.thumbnail_url ?? null,
      };
    });

    try {
      window.localStorage.setItem(GUEST_PREVIEW_CACHE_KEY, JSON.stringify(cacheRows));
    } catch {
      // ignore storage write failures (private mode/quota)
    }
  }, [photos, resolvedPhotoUrls]);

  const loadProfile = useCallback(async (user: User) => {
    if (!supabase) return;

    const { data, error, status } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error && status !== 406) {
      setProfileState({
        state: 'error',
        message: null,
        error: toApiError(error, 'Profil konnte nicht geladen werden.'),
      });
      return;
    }

    let row = (data as UserProfile | null) ?? {
      id: user.id,
      email: user.email ?? null,
      park_id: PLOSE_PARK_ID,
      park_name: PLOSE_PARK_NAME,
      display_name: (user.user_metadata?.display_name as string | undefined) ?? '',
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? '',
      popup_enabled: true,
    };

    const metadataDisplayName = (user.user_metadata?.display_name as string | undefined)?.trim() ?? '';
    const metadataAvatarUrl = (user.user_metadata?.avatar_url as string | undefined)?.trim() ?? '';
    const rowDisplayName = resolveProfileDisplayName(row);
    if (!rowDisplayName && metadataDisplayName) {
      row = {
        ...row,
        display_name: metadataDisplayName,
      };
    }
    if ((typeof row.avatar_url !== 'string' || !row.avatar_url.trim()) && metadataAvatarUrl) {
      row = {
        ...row,
        avatar_url: metadataAvatarUrl,
      };
    }

    if (row.park_id && row.park_id !== PLOSE_PARK_ID) {
      await supabase.auth.signOut();
      setAuthState({
        state: 'error',
        message: null,
        error: {
          code: 'park_mismatch',
          message: 'Dieses Konto gehört zu einem anderen Park und kann hier nicht genutzt werden.',
        },
      });
      setProfileState({
        state: 'error',
        message: null,
        error: {
          code: 'park_mismatch',
          message: 'Dieses Konto gehört zu einem anderen Park und kann hier nicht genutzt werden.',
        },
      });
      return;
    }

    if (!data || !row.park_id) {
      const assignmentError = await upsertPloseUserAssignment(user);
      if (assignmentError) {
        setProfileState({
          state: 'error',
          message: null,
          error: assignmentError,
        });
        return;
      }

      row = {
        ...row,
        park_id: PLOSE_PARK_ID,
        park_name: PLOSE_PARK_NAME,
      };
    }

    const resolvedDisplayName = resolveProfileDisplayName(row) || metadataDisplayName;
    const resolvedAvatarUrl =
      (typeof row.avatar_url === 'string' && row.avatar_url.trim()
        ? row.avatar_url.trim()
        : metadataAvatarUrl) || '';

    setProfile({
      ...row,
      display_name: resolvedDisplayName,
      avatar_url: resolvedAvatarUrl,
    });
    setProfileDisplayName(resolvedDisplayName);
    setProfileAvatarUrl(resolvedAvatarUrl);
    setDeleteEmailConfirm(user.email ?? '');
    setProfileState({ state: 'success', message: null, error: null });
  }, [upsertPloseUserAssignment]);

  const loadFavorites = useCallback(async (userId: string) => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from('favorites')
      .select('*')
      .eq('user_id', userId)
      .eq('park_id', PLOSE_PARK_ID);

    if (error) {
      setFavoritesState({
        state: 'error',
        message: null,
        error: toApiError(error, 'Favoriten konnten nicht geladen werden.'),
      });
      return;
    }

    setFavorites(
      new Set(
        (data ?? [])
          .map((row) => row.photo_id as string | null)
          .filter((id): id is string => Boolean(id))
      )
    );
    setFavoritesState({ state: 'success', message: null, error: null });
  }, []);

  const loadFavoritePhotos = useCallback(
    async (favoriteIds: string[]) => {
      if (!supabase) return;

      const uniqueIds = [...new Set(favoriteIds.filter(Boolean))];
      if (uniqueIds.length === 0) {
        setFavoritePhotos([]);
        setFavoritePhotosState({ state: 'success', message: null, error: null });
        return;
      }

      setFavoritePhotosState({ state: 'loading', message: null, error: null });

      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .eq('park_id', PLOSE_PARK_ID)
        .in('id', uniqueIds);

      if (error) {
        setFavoritePhotos([]);
        setFavoritePhotosState({
          state: 'error',
          message: null,
          error: toApiError(error, 'Favoriten-Bilder konnten nicht geladen werden.'),
        });
        return;
      }

      const byId = new Map(
        ((data ?? []) as Photo[])
          .map((photo) => normalizePhotoForShop(photo, stripeDemoPriceId))
          .map((photo) => [photo.id, photo])
      );
      const ordered = uniqueIds
        .map((id) => byId.get(id) ?? null)
        .filter((photo): photo is Photo => Boolean(photo));

      setFavoritePhotos(ordered);
      setFavoritePhotosState({ state: 'success', message: null, error: null });
    },
    [stripeDemoPriceId]
  );

  const loadCart = useCallback(async (userId: string) => {
    if (!supabase) return;

    const { data: cartRows, error: cartError } = await supabase
      .from('cart_items')
      .select('*')
      .eq('user_id', userId)
      .eq('park_id', PLOSE_PARK_ID)
      .order('created_at', { ascending: false });

    if (cartError) {
      setCartState({ state: 'error', message: null, error: toApiError(cartError, 'Warenkorb laden fehlgeschlagen.') });
      return;
    }

    const rows = (cartRows ?? []) as CartItem[];
    const ids = rows
      .map((row) => row.photo_id)
      .filter((id): id is string => Boolean(id));

    if (ids.length === 0) {
      setCartItems(rows);
      setCartState({ state: 'success', message: null, error: null });
      return;
    }

    const { data: photoRows, error: photoError } = await supabase.from('photos').select('*').in('id', ids);

    if (photoError) {
      setCartState({ state: 'error', message: null, error: toApiError(photoError, 'Produktdaten konnten nicht geladen werden.') });
      return;
    }

    const photoById = new Map(
      ((photoRows ?? []) as Photo[])
        .map((photo) => normalizePhotoForShop(photo, stripeDemoPriceId))
        .map((photo) => [photo.id, photo])
    );
    setCartItems(
      rows.map((row) => ({
        ...row,
        photo: photoById.get(row.photo_id) ?? null,
      }))
    );
    setCartState({ state: 'success', message: null, error: null });
  }, [stripeDemoPriceId]);

  const loadPurchasesAndUnlocks = useCallback(
    async (userId: string, parkId: string = PLOSE_PARK_ID) => {
      if (!supabase) return;
      const sb = supabase;

      type UnlockedWithPhotoRow = UnlockedPhoto & {
        photos?: Photo | Photo[] | null;
      };

      const parkFilter = `park_id.eq.${parkId},park_id.is.null`;

      const fetchUnlockJoin = (withParkFilter: boolean) => {
        let query = sb
          .from('unlocked_photos')
          .select(`
            *,
            photos (
              id,
              ride_id,
              park_id,
              storage_bucket,
              storage_path,
              image_url,
              thumbnail_url,
              captured_at,
              speed_kmh,
              created_at,
              price_cents,
              price_id,
              stripe_price_id
            )
          `)
          .eq('user_id', userId);

        if (withParkFilter) {
          query = query.or(parkFilter);
        }

        return query.order('unlocked_at', { ascending: false });
      };

      const fetchPurchases = (withParkFilter: boolean) => {
        let query = sb.from('purchases').select('*').eq('user_id', userId);
        if (withParkFilter) {
          query = query.or(parkFilter);
        }
        return query.order('created_at', { ascending: false });
      };

      let [unlockJoinResult, purchaseResult] = await Promise.all([
        fetchUnlockJoin(true),
        fetchPurchases(true),
      ]);

      const unlockJoinRows = (unlockJoinResult.data ?? []) as UnlockedWithPhotoRow[];
      const purchaseRows = (purchaseResult.data ?? []) as Purchase[];

      if (!unlockJoinResult.error && unlockJoinRows.length === 0) {
        const fallbackUnlockJoin = await fetchUnlockJoin(false);
        if (!fallbackUnlockJoin.error && (fallbackUnlockJoin.data ?? []).length > 0) {
          unlockJoinResult = fallbackUnlockJoin;
        }
      }

      if (!purchaseResult.error && purchaseRows.length === 0) {
        const fallbackPurchases = await fetchPurchases(false);
        if (!fallbackPurchases.error && (fallbackPurchases.data ?? []).length > 0) {
          purchaseResult = fallbackPurchases;
        }
      }

      let unlockRows: UnlockedPhoto[] = [];
      let purchasedFromUnlocks: Photo[] = [];
      let purchasedFromPurchaseItems: Photo[] = [];

      if (!unlockJoinResult.error) {
        const joinedRows = (unlockJoinResult.data ?? []) as UnlockedWithPhotoRow[];
        unlockRows = joinedRows as UnlockedPhoto[];

        purchasedFromUnlocks = joinedRows
          .map((row) => (Array.isArray(row.photos) ? row.photos[0] ?? null : row.photos ?? null))
          .filter((photo): photo is Photo => Boolean(photo))
          .map((photo) => normalizePhotoForShop(photo, stripeDemoPriceId));
      } else {
        // Fallback if PostgREST relation join "unlocked_photos -> photos" is not available in this project.
        const fetchUnlockOnly = (withParkFilter: boolean) => {
          let query = sb.from('unlocked_photos').select('*').eq('user_id', userId);
          if (withParkFilter) {
            query = query.or(parkFilter);
          }
          return query.order('unlocked_at', { ascending: false });
        };

        let unlockOnlyResult = await fetchUnlockOnly(true);
        if (!unlockOnlyResult.error && ((unlockOnlyResult.data ?? []) as UnlockedPhoto[]).length === 0) {
          const fallbackUnlockOnly = await fetchUnlockOnly(false);
          if (!fallbackUnlockOnly.error && (fallbackUnlockOnly.data ?? []).length > 0) {
            unlockOnlyResult = fallbackUnlockOnly;
          }
        }

        const unlockOnlyRows = unlockOnlyResult.data;
        const unlockOnlyError = unlockOnlyResult.error;

        if (unlockOnlyError) {
          setCartState({
            state: 'error',
            message: null,
            error: toApiError(unlockOnlyError, 'Freischaltungen konnten nicht geladen werden.'),
          });
          unlockRows = [];
        } else {
          unlockRows = (unlockOnlyRows ?? []) as UnlockedPhoto[];

          const unlockedPhotoIds = [...new Set(
            unlockRows
              .map((row) => row.photo_id ?? null)
              .filter((photoId): photoId is string => Boolean(photoId))
          )];

          if (unlockedPhotoIds.length > 0) {
            const { data: unlockedPhotoRows, error: unlockedPhotoError } = await sb
              .from('photos')
              .select('*')
              .in('id', unlockedPhotoIds);

            if (unlockedPhotoError) {
              setCartState({
                state: 'error',
                message: null,
                error: toApiError(unlockedPhotoError, 'Freigeschaltete Fotos konnten nicht geladen werden.'),
              });
            } else {
              const photoById = new Map(
                ((unlockedPhotoRows ?? []) as Photo[])
                  .map((photo) => normalizePhotoForShop(photo, stripeDemoPriceId))
                  .map((photo) => [photo.id, photo] as const)
              );

              purchasedFromUnlocks = unlockedPhotoIds
                .map((photoId) => photoById.get(photoId) ?? null)
                .filter((photo): photo is Photo => Boolean(photo));
            }
          }
        }
      }

      setUnlockedPhotos(unlockRows);

      const purchaseRowsFinal = (purchaseResult.data ?? []) as Purchase[];
      const purchaseIds = [...new Set(
        purchaseRowsFinal
          .map((row) => (typeof row.id === 'string' ? row.id : null))
          .filter((id): id is string => Boolean(id))
      )];

      if (purchaseIds.length > 0) {
        const { data: purchaseItemsRows, error: purchaseItemsError } = await sb
          .from('purchase_items')
          .select('*')
          .in('purchase_id', purchaseIds)
          .order('created_at', { ascending: false });

        if (!purchaseItemsError) {
          const purchaseItemPhotoIds = [...new Set(
            ((purchaseItemsRows ?? []) as Array<{ photo_id?: string | null }>)
              .map((row) => (typeof row.photo_id === 'string' ? row.photo_id : null))
              .filter((id): id is string => Boolean(id))
          )];

          if (purchaseItemPhotoIds.length > 0) {
            const { data: purchaseItemPhotosRows, error: purchaseItemPhotosError } = await sb
              .from('photos')
              .select('*')
              .in('id', purchaseItemPhotoIds);

            if (!purchaseItemPhotosError) {
              purchasedFromPurchaseItems = ((purchaseItemPhotosRows ?? []) as Photo[]).map((photo) =>
                normalizePhotoForShop(photo, stripeDemoPriceId)
              );
            }
          }
        }
      }

      const uniquePurchasedPhotos: Photo[] = [];
      const seenPhotoIds = new Set<string>();
      for (const photo of [...purchasedFromUnlocks, ...purchasedFromPurchaseItems]) {
        if (seenPhotoIds.has(photo.id)) continue;
        seenPhotoIds.add(photo.id);
        uniquePurchasedPhotos.push(photo);
      }
      const confirmedPhotoIds = new Set<string>(seenPhotoIds);

      if (typeof window !== 'undefined') {
        const rawPending = window.localStorage.getItem(pendingCheckoutStorageKey(userId));
        if (rawPending) {
          try {
            const parsed = JSON.parse(rawPending) as { photoIds?: unknown; createdAt?: unknown };
            const photoIds = Array.isArray(parsed.photoIds)
              ? parsed.photoIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
              : [];
            const createdAt =
              typeof parsed.createdAt === 'number' ? parsed.createdAt : Number(parsed.createdAt ?? 0);
            const isFresh = Number.isFinite(createdAt) && Date.now() - createdAt < 1000 * 60 * 60 * 2;

            if (isFresh && photoIds.length > 0) {
              const missingPendingPhotoIds = photoIds.filter((id) => !confirmedPhotoIds.has(id));

              if (missingPendingPhotoIds.length === 0) {
                window.localStorage.removeItem(pendingCheckoutStorageKey(userId));
              } else {
                const { data: pendingPhotosRows, error: pendingPhotosError } = await sb
                  .from('photos')
                  .select('*')
                  .in('id', missingPendingPhotoIds);

                if (!pendingPhotosError) {
                  for (const photo of (pendingPhotosRows ?? []) as Photo[]) {
                    if (seenPhotoIds.has(photo.id)) continue;
                    seenPhotoIds.add(photo.id);
                    uniquePurchasedPhotos.push(normalizePhotoForShop(photo, stripeDemoPriceId));
                  }

                  const unresolvedPendingIds = missingPendingPhotoIds.filter(
                    (id) => !confirmedPhotoIds.has(id)
                  );
                  if (unresolvedPendingIds.length === 0) {
                    window.localStorage.removeItem(pendingCheckoutStorageKey(userId));
                  } else {
                    window.localStorage.setItem(
                      pendingCheckoutStorageKey(userId),
                      JSON.stringify({
                        photoIds: unresolvedPendingIds,
                        createdAt,
                      })
                    );
                  }
                }
              }
            } else if (!isFresh) {
              window.localStorage.removeItem(pendingCheckoutStorageKey(userId));
            }
          } catch {
            window.localStorage.removeItem(pendingCheckoutStorageKey(userId));
          }
        }
      }

      setPurchasedPhotos(uniquePurchasedPhotos);

      if (purchaseResult.error) {
        // Keep purchased image rendering working from unlocked_photos even if purchases query fails.
        setPurchases([]);
        return;
      }

      setPurchases((purchaseResult.data ?? []) as Purchase[]);
    },
    [stripeDemoPriceId]
  );

  const hydratePhotoUrls = useCallback(async (inputPhotos: Photo[]) => {
    if (!supabase || inputPhotos.length === 0) return;

    const uniquePhotos = [...new Map(inputPhotos.map((photo) => [photo.id, photo])).values()];
    const nextResolvedUrls: Record<string, string> = {};
    const pathToPhotoIds = new Map<string, string[]>();
    const pathsByBucket = new Map<string, Set<string>>();

    for (const photo of uniquePhotos) {
      const direct = directPhotoUrl(photo);
      if (direct) {
        nextResolvedUrls[photo.id] = direct;
      }

      const storageRef = extractStorageRef(photo);
      if (!storageRef) continue;
      const key = `${storageRef.bucket}::${storageRef.objectPath}`;

      const ids = pathToPhotoIds.get(key) ?? [];
      ids.push(photo.id);
      pathToPhotoIds.set(key, ids);

      const bucketPaths = pathsByBucket.get(storageRef.bucket) ?? new Set<string>();
      bucketPaths.add(storageRef.objectPath);
      pathsByBucket.set(storageRef.bucket, bucketPaths);
    }

    const assignUrlForStoragePath = (bucket: string, objectPath: string, url: string | null) => {
      if (!url) return;
      const key = `${bucket}::${objectPath}`;
      const photoIds = pathToPhotoIds.get(key);
      if (!photoIds) return;
      for (const photoId of photoIds) {
        nextResolvedUrls[photoId] = url;
      }
    };

    for (const [bucket, objectPathSet] of pathsByBucket.entries()) {
      const paths = [...objectPathSet];
      const chunkSize = 100;

      for (let offset = 0; offset < paths.length; offset += chunkSize) {
        const chunk = paths.slice(offset, offset + chunkSize);
        let unresolved = [...chunk];

        const { data: signedData, error: signedError } = await supabase.storage
          .from(bucket)
          .createSignedUrls(chunk, 60 * 60);

        if (!signedError && Array.isArray(signedData)) {
          unresolved = [];
          signedData.forEach((entry, index) => {
            const path = typeof entry?.path === 'string' && entry.path ? entry.path : chunk[index];
            const signedUrl =
              typeof entry?.signedUrl === 'string' && entry.signedUrl
                ? normalizeToAbsoluteUrl(entry.signedUrl)
                : null;

            if (signedUrl) {
              assignUrlForStoragePath(bucket, path, signedUrl);
            } else if (path) {
              unresolved.push(path);
            }
          });
        }

        for (const objectPath of unresolved) {
          const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
          const publicUrl =
            publicData && typeof publicData.publicUrl === 'string'
              ? normalizeToAbsoluteUrl(publicData.publicUrl)
              : null;
          assignUrlForStoragePath(bucket, objectPath, publicUrl);
        }
      }
    }

    setResolvedPhotoUrls((previous) => ({ ...previous, ...nextResolvedUrls }));
    setFailedPhotoUrlById((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const [photoId, resolvedUrl] of Object.entries(nextResolvedUrls)) {
        if (next[photoId] && next[photoId] !== resolvedUrl) {
          delete next[photoId];
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, []);

  const loadLeaderboard = useCallback(async () => {
    if (!supabase) return;
    const parkToday = dateKeyInTimeZone(new Date(), PLOSE_TIMEZONE);

    const readCachedLeaderboard = (): LeaderboardEntry[] => {
      if (typeof window === 'undefined') return [];
      try {
        const raw = window.localStorage.getItem(GUEST_LEADERBOARD_CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter(
            (entry): entry is LeaderboardEntry =>
              Boolean(entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string')
          )
          .slice(0, 20);
      } catch {
        return [];
      }
    };

    const writeCachedLeaderboard = (rows: LeaderboardEntry[]) => {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(GUEST_LEADERBOARD_CACHE_KEY, JSON.stringify(rows.slice(0, 20)));
      } catch {
        // ignore storage write failures (private mode/quota)
      }
    };

    const fetchLeaderboardRows = async (client: any) =>
      client
        .from('leaderboard_entries')
        .select('*')
        .eq('park_id', PLOSE_PARK_ID)
        .order('created_at', { ascending: false })
        .limit(200);

    let { data, error } = await fetchLeaderboardRows(supabase);

    if (error && !currentUser) {
      const guestClient = createEphemeralSupabaseClient();
      if (guestClient) {
        const { error: signInError } = await guestClient.auth.signInAnonymously();
        if (!signInError) {
          const guestResult = await fetchLeaderboardRows(guestClient);
          data = guestResult.data;
          error = guestResult.error;
        }
      }
    }

    if (error) {
      if (!currentUser) {
        const cachedRows = readCachedLeaderboard();
        if (cachedRows.length > 0) {
          setLeaderboardEntries(cachedRows);
          setLeaderboardState({ state: 'success', message: null, error: null });
          return;
        }
      }

      setLeaderboardState({
        state: 'error',
        message: null,
        error: toApiError(error, 'Leaderboard konnte nicht geladen werden.'),
      });
      return;
    }

    const baseEntries = ((data ?? []) as LeaderboardEntry[])
      .map((entry) => ({ ...entry }))
      .filter((entry) => {
        const dateKey = toDateKey(
          (entry.ride_date as string | undefined) ?? (entry.created_at as string | undefined) ?? null
        );
        return dateKey === parkToday;
      })
      .sort((a, b) => {
        const speedA = typeof a.speed_kmh === 'number' ? a.speed_kmh : 0;
        const speedB = typeof b.speed_kmh === 'number' ? b.speed_kmh : 0;
        return speedB - speedA;
      })
      .slice(0, 20);

    if (!currentUser && baseEntries.length === 0) {
      const cachedRows = readCachedLeaderboard();
      if (cachedRows.length > 0) {
        setLeaderboardEntries(cachedRows);
        setLeaderboardState({ state: 'success', message: null, error: null });
        return;
      }
    }

    const userIds = [...new Set(
      baseEntries
        .map((entry) => (typeof entry.user_id === 'string' ? entry.user_id : null))
        .filter((id): id is string => Boolean(id))
    )];

    type UserRow = {
      id?: string | null;
      email?: string | null;
      display_name?: string | null;
      vorname?: string | null;
      nachname?: string | null;
      avatar_url?: string | null;
      [key: string]: unknown;
    };

    const userById = new Map<string, UserRow>();
    if (userIds.length > 0) {
      const { data: userRows, error: userError } = await supabase
        .from('users')
        .select('*')
        .in('id', userIds);

      if (!userError) {
        for (const row of (userRows ?? []) as UserRow[]) {
          const id = typeof row.id === 'string' ? row.id : null;
          if (!id) continue;
          userById.set(id, row);
        }
      }
    }

    const resolveDisplayName = (entry: LeaderboardEntry): string => {
      const direct = typeof entry.display_name === 'string' ? entry.display_name.trim() : '';
      if (direct) return direct;

      const user = typeof entry.user_id === 'string' ? userById.get(entry.user_id) : null;
      const userDisplay = typeof user?.display_name === 'string' ? user.display_name.trim() : '';
      if (userDisplay) return userDisplay;

      const first = typeof user?.vorname === 'string' ? user.vorname.trim() : '';
      const last = typeof user?.nachname === 'string' ? user.nachname.trim() : '';
      const fullName = `${first} ${last}`.trim();
      if (fullName) return fullName;

      return 'Fahrer/in';
    };

    const enriched = baseEntries
      .map((entry) => {
        const user = typeof entry.user_id === 'string' ? userById.get(entry.user_id) : null;
        const entryAvatar =
          typeof entry.avatar_url === 'string' && entry.avatar_url.trim()
            ? entry.avatar_url.trim()
            : '';
        const userAvatar =
          typeof user?.avatar_url === 'string' && user.avatar_url.trim()
            ? user.avatar_url.trim()
            : '';

        return {
          ...entry,
          display_name: resolveDisplayName(entry),
          avatar_url: resolveAvatarUrlValue(userAvatar || entryAvatar || null),
        } as LeaderboardEntry;
      })
      .sort((a, b) => {
        const speedA = typeof a.speed_kmh === 'number' ? a.speed_kmh : 0;
        const speedB = typeof b.speed_kmh === 'number' ? b.speed_kmh : 0;
        return speedB - speedA;
      })
      .map((entry, index) => ({
        ...entry,
        rank_position: index + 1,
      }));

    setLeaderboardEntries(enriched);
    setLeaderboardState({ state: 'success', message: null, error: null });
    if (enriched.length > 0) {
      writeCachedLeaderboard(enriched);
    }
  }, [currentUser]);

  const loadNewsletter = useCallback(async (user: User) => {
    if (!supabase) return;

    const { data, error, status } = await supabase
      .from('newsletter_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .eq('park_id', PLOSE_PARK_ID)
      .maybeSingle();

    if (error && status !== 406) {
      setNewsletterState({
        state: 'error',
        message: null,
        error: toApiError(error, 'Newsletter-Einstellungen konnten nicht geladen werden.'),
      });
      return;
    }

    const fallback: NewsletterSubscription = {
      user_id: user.id,
      park_id: PLOSE_PARK_ID,
      email: user.email ?? '',
      subscribed: false,
      popup_enabled: true,
    };

    const resolvedNewsletter = (data as NewsletterSubscription | null) ?? fallback;
    setNewsletter(resolvedNewsletter);
    if (typeof resolvedNewsletter.popup_enabled === 'boolean') {
      setProfile((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          popup_enabled: resolvedNewsletter.popup_enabled,
        };
      });
    }
    setNewsletterState({ state: 'success', message: null, error: null });
  }, []);

  const hydrateUserData = useCallback(
    async (user: User) => {
      await Promise.all([
        loadProfile(user),
        loadFavorites(user.id),
        loadCart(user.id),
        loadPurchasesAndUnlocks(user.id),
        loadLeaderboard(),
        loadNewsletter(user),
      ]);
    },
    [loadCart, loadFavorites, loadLeaderboard, loadNewsletter, loadProfile, loadPurchasesAndUnlocks]
  );

  useEffect(() => {
    if (!currentUser) {
      resetUserData();
      void loadLeaderboard();
      void loadPhotos();
      return;
    }

    setLoginAttention(false);
    setLoginAttentionMessage(null);
    void hydrateUserData(currentUser);
  }, [currentUser, hydrateUserData, loadLeaderboard, resetUserData]);

  useEffect(() => {
    if (!currentUser) return;
    if (!popupEnabled) return;
    if (!newsletter) return;
    if (newsletter.subscribed) return;
    if (newsletterPromptedUserRef.current === currentUser.id) return;

    const timerId = window.setTimeout(() => {
      openPromoPopup('newsletter');
      newsletterPromptedUserRef.current = currentUser.id;
    }, 10000);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [currentUser, newsletter, openPromoPopup, popupEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!currentUser) {
      setDayPassInCart(false);
      return;
    }
    const stored = window.localStorage.getItem(dayPassStorageKey(currentUser.id));
    setDayPassInCart(stored === '1');
  }, [currentUser]);

  useEffect(() => {
    void loadRides();
  }, [loadRides]);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  useEffect(() => {
    if (!currentUser) {
      setShowGalleryFilters(false);
      setShowAllGalleryPhotos(false);
      return;
    }

    setShowAllGalleryPhotos(false);
  }, [currentUser, selectedDate, selectedRideId, selectedTime]);

  useEffect(() => {
    if (!currentUser) {
      setFavoritePhotos([]);
      setFavoritePhotosState(initialMessageState());
      return;
    }

    void loadFavoritePhotos(Array.from(favorites));
  }, [currentUser, favorites, loadFavoritePhotos]);

  const photosForUrlHydration = useMemo(() => {
    return [...new Map([...photos, ...purchasedPhotos].map((photo) => [photo.id, photo])).values()];
  }, [photos, purchasedPhotos]);

  useEffect(() => {
    void hydratePhotoUrls(photosForUrlHydration);
  }, [hydratePhotoUrls, photosForUrlHydration]);

  useEffect(() => {
    if (!currentUser || !supabase) return;
    const sb = supabase;

    const params = new URLSearchParams(window.location.search);
    const checkoutStateParam = params.get('checkout');
    const checkoutSessionId = params.get('session_id');
    if (!checkoutStateParam) return;

    let isActive = true;
    const timers: number[] = [];
    const baselineUnlockedCount = unlockedPhotos.length;

    if (checkoutStateParam === 'success') {
      // Return page UX: clear local cart immediately, webhook remains source of truth.
      setCartItems([]);
      setDayPassInCart(false);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(dayPassStorageKey(currentUser.id));
      }
      setCheckoutState({
        state: 'success',
        message: 'Zahlung erfolgreich. Wir synchronisieren deine Käufe...',
        error: null,
      });

      if (checkoutSessionId) {
        void (async () => {
          for (let attempt = 0; attempt < 12; attempt += 1) {
            if (!isActive) return;

            const { data, error } = await sb
              .from('purchases')
              .select('id,user_id,park_id,stripe_checkout_session_id')
              .eq('stripe_checkout_session_id', checkoutSessionId)
              .eq('user_id', currentUser.id)
              .maybeSingle();

            if (!isActive) return;

            if (!error && data) {
              await Promise.all([
                loadCart(currentUser.id),
                loadPurchasesAndUnlocks(currentUser.id),
                loadLeaderboard(),
              ]);
              if (!isActive) return;
              setCheckoutState({
                state: 'success',
                message: 'Zahlung erfolgreich. Bilder wurden freigeschaltet.',
                error: null,
              });
              return;
            }

            await new Promise((resolve) => {
              const timerId = window.setTimeout(resolve, 1500);
              timers.push(timerId);
            });
          }

          if (!isActive) return;
          setCheckoutState({
            state: 'success',
            message: 'Zahlung erfolgreich. Webhook verarbeitet die Freischaltung noch...',
            error: null,
          });
        })();
      }

      const delaysMs = [2000, 5000, 10000, 15000, 25000, 40000, 60000];
      delaysMs.forEach((delay) => {
        const timerId = window.setTimeout(() => {
          if (!isActive) return;
          void Promise.all([
            loadCart(currentUser.id),
            loadPurchasesAndUnlocks(currentUser.id),
            loadLeaderboard(),
          ]);

          if (delay === 60000) {
            void (async () => {
              const { count } = await sb
                .from('unlocked_photos')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', currentUser.id)
                .or(`park_id.eq.${PLOSE_PARK_ID},park_id.is.null`);

              if (!isActive) return;
              if ((count ?? 0) <= baselineUnlockedCount) {
                setCheckoutState({
                  state: 'success',
                  message:
                    'Zahlung erfolgreich. Freischaltung kann bis zu 1-2 Minuten dauern. Bitte kurz warten und dann aktualisieren.',
                  error: null,
                });
              }
            })();
          }
        }, delay);
        timers.push(timerId);
      });
    } else if (checkoutStateParam === 'cancel') {
      setCheckoutState({
        state: 'error',
        message: null,
        error: { code: 'checkout_cancelled', message: 'Checkout wurde abgebrochen.' },
      });
    }

    params.delete('checkout');
    params.delete('session_id');
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
    window.history.replaceState({}, '', nextUrl);

    return () => {
      isActive = false;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [currentUser, loadCart, loadLeaderboard, loadPurchasesAndUnlocks, supabase, unlockedPhotos.length]);

  useEffect(() => {
    if (checkoutState.state !== 'success') return;
    if (!checkoutState.message?.toLowerCase().includes('zahlung erfolgreich')) return;

    const timerId = window.setTimeout(() => {
      setCheckoutState((previous) => {
        if (previous.state !== 'success') return previous;
        return initialMessageState();
      });
    }, 7000);

    return () => window.clearTimeout(timerId);
  }, [checkoutState.message, checkoutState.state]);

  const unlockedPhotoIds = useMemo(
    () =>
      new Set(
        unlockedPhotos
          .map((row) => row.photo_id ?? null)
          .filter((id): id is string => Boolean(id))
      ),
    [unlockedPhotos]
  );

  const purchasedPhotoIds = useMemo(
    () => new Set(purchasedPhotos.map((photo) => photo.id)),
    [purchasedPhotos]
  );

  const unlockedDayKeys = useMemo(
    () =>
      new Set(
        unlockedPhotos
          .filter((row) => !row.photo_id)
          .map((row) => unlockedDayKey(row))
          .filter((key): key is string => Boolean(key))
      ),
    [unlockedPhotos]
  );

  const todayParkDateKey = useMemo(() => dateKeyInTimeZone(new Date(), PLOSE_TIMEZONE), []);

  const hasTodayDayPass = useMemo(
    () =>
      unlockedPhotos.some((row) => {
        if (row.photo_id) return false;
        return unlockedDayKey(row) === todayParkDateKey;
      }),
    [todayParkDateKey, unlockedPhotos]
  );

  useEffect(() => {
    if (!currentUser) return;
    if (!hasTodayDayPass) return;
    setDayPassInCart(false);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(dayPassStorageKey(currentUser.id));
    }
  }, [currentUser, hasTodayDayPass]);

  const isPhotoUnlocked = useCallback(
    (photo: Photo) => {
      if (purchasedPhotoIds.has(photo.id)) return true;
      if (unlockedPhotoIds.has(photo.id)) return true;
      const day = photoDayKey(photo);
      return Boolean(day && unlockedDayKeys.has(day));
    },
    [purchasedPhotoIds, unlockedDayKeys, unlockedPhotoIds]
  );

  const myTopSpeed = useMemo(() => {
    const speeds = purchasedPhotos.map((photo) => photoSpeedKmh(photo)).filter((value): value is number => value !== null);
    if (speeds.length === 0) return null;
    return Math.max(...speeds);
  }, [purchasedPhotos]);

  const myTodayBest = useMemo(() => {
    const photoById = new Map(purchasedPhotos.map((photo) => [photo.id, photo]));
    const candidates = unlockedPhotos
      .filter((row) => {
        const photoId = typeof row.photo_id === 'string' ? row.photo_id : '';
        if (!photoId) return false;
        return unlockedDayKey(row) === todayParkDateKey;
      })
      .map((row) => {
        const photoId = typeof row.photo_id === 'string' ? row.photo_id : '';
        const photo = photoById.get(photoId);
        if (!photo) return null;
        const speed = photoSpeedKmh(photo);
        if (speed === null) return null;
        return {
          photoId,
          speed,
        };
      })
      .filter((value): value is { photoId: string; speed: number } => value !== null);

    if (candidates.length === 0) {
      return { speed: null, photoId: null as string | null };
    }

    const best = candidates.reduce((previous, current) =>
      current.speed > previous.speed ? current : previous
    );

    return {
      speed: best.speed,
      photoId: best.photoId,
    };
  }, [purchasedPhotos, todayParkDateKey, unlockedPhotos]);

  const myTodayTopSpeed = myTodayBest.speed;

  const syncTodayLeaderboardEntry = useCallback(async () => {
    if (!supabase || !currentUser) return;
    const sb = supabase;

    const profileName = profileDisplayName.trim();
    const storedName = typeof profile?.display_name === 'string' ? profile.display_name.trim() : '';
    const firstName = typeof profile?.vorname === 'string' ? profile.vorname.trim() : '';
    const lastName = typeof profile?.nachname === 'string' ? profile.nachname.trim() : '';
    const fullName = `${firstName} ${lastName}`.trim();
    const displayName = profileName || storedName || fullName || '';
    const displayNameForUi = displayName || 'Fahrer/in';

    const profileAvatarCandidate = profileAvatarUrl.trim();
    const storedAvatar = typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '';
    const avatarUrl = resolveAvatarUrlValue(profileAvatarCandidate || storedAvatar || null) ?? '';

    const syncKey = [
      currentUser.id,
      todayParkDateKey,
      myTodayTopSpeed === null ? 'no-speed' : myTodayTopSpeed.toFixed(2),
      myTodayBest.photoId ?? '',
      displayNameForUi,
      avatarUrl,
    ].join('|');
    if (leaderboardSyncKeyRef.current === syncKey) return;

    type ExistingLeaderboardRow = {
      id?: string | null;
      speed_kmh?: number | null;
      display_name?: string | null;
      avatar_url?: string | null;
    };

    const readExistingRow = async (withProfileColumns: boolean) => {
      if (withProfileColumns) {
        return sb
          .from('leaderboard_entries')
          .select('id,speed_kmh,display_name,avatar_url')
          .eq('user_id', currentUser.id)
          .eq('park_id', PLOSE_PARK_ID)
          .eq('ride_date', todayParkDateKey)
          .order('speed_kmh', { ascending: false })
          .limit(1);
      }

      return sb
        .from('leaderboard_entries')
        .select('id,speed_kmh')
        .eq('user_id', currentUser.id)
        .eq('park_id', PLOSE_PARK_ID)
        .eq('ride_date', todayParkDateKey)
        .order('speed_kmh', { ascending: false })
        .limit(1);
    };

    const preferProfileColumns = leaderboardProfileColumnsRef.current !== false;
    const firstRead = await readExistingRow(preferProfileColumns);
    let existingRows = (firstRead.data as ExistingLeaderboardRow[] | null) ?? null;
    let existingError = firstRead.error;
    let existingStatus = firstRead.status;

    let canPersistProfileSnapshot = preferProfileColumns;
    if (
      preferProfileColumns &&
      existingError &&
      typeof existingError.message === 'string' &&
      (existingError.message.includes('display_name') || existingError.message.includes('avatar_url'))
    ) {
      leaderboardProfileColumnsRef.current = false;
      canPersistProfileSnapshot = false;
      const fallback = await readExistingRow(false);
      existingRows = (fallback.data as ExistingLeaderboardRow[] | null) ?? null;
      existingError = fallback.error;
      existingStatus = fallback.status;
    }

    if (existingError && existingStatus !== 406) {
      return;
    }

    const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;
    if (existing && typeof existing.id === 'string') {
      const existingSpeed = typeof existing.speed_kmh === 'number' ? existing.speed_kmh : 0;
      const nextSpeed =
        typeof myTodayTopSpeed === 'number' ? Math.max(existingSpeed, myTodayTopSpeed) : existingSpeed;
      const existingDisplayName =
        typeof (existing as { display_name?: unknown }).display_name === 'string'
          ? String((existing as { display_name?: unknown }).display_name).trim()
          : '';
      const existingAvatarUrl =
        typeof (existing as { avatar_url?: unknown }).avatar_url === 'string'
          ? String((existing as { avatar_url?: unknown }).avatar_url).trim()
          : '';
      const shouldUpdateProfile = existingDisplayName !== displayName || existingAvatarUrl !== avatarUrl;
      if (nextSpeed === existingSpeed && !shouldUpdateProfile) {
        leaderboardSyncKeyRef.current = syncKey;
        return;
      }

      const updatePayload: Record<string, unknown> = {};
      if (nextSpeed !== existingSpeed) {
        updatePayload.speed_kmh = nextSpeed;
      }
      if (canPersistProfileSnapshot) {
        updatePayload.display_name = displayName || null;
        updatePayload.avatar_url = avatarUrl;
      }
      if (myTodayBest.photoId) {
        updatePayload.photo_id = myTodayBest.photoId;
      }
      const { error: updateError } = await supabase
        .from('leaderboard_entries')
        .update(updatePayload)
        .eq('id', existing.id);
      if (!updateError) {
        setLeaderboardEntries((previous) =>
          previous.map((entry) => {
            if (entry.id !== existing.id) return entry;
            return {
              ...entry,
              speed_kmh: nextSpeed,
              photo_id: myTodayBest.photoId ?? entry.photo_id,
              display_name: canPersistProfileSnapshot ? displayName || null : entry.display_name,
              avatar_url: canPersistProfileSnapshot ? avatarUrl : entry.avatar_url,
            };
          })
        );
        leaderboardSyncKeyRef.current = syncKey;
      } else if (
        canPersistProfileSnapshot &&
        typeof updateError.message === 'string' &&
        (updateError.message.includes('display_name') || updateError.message.includes('avatar_url'))
      ) {
        leaderboardProfileColumnsRef.current = false;
      }
      return;
    }

    if (myTodayTopSpeed === null) {
      // No speed candidate available yet, so we cannot create a new leaderboard row.
      return;
    }

    const insertPayload: Record<string, unknown> = {
      user_id: currentUser.id,
      park_id: PLOSE_PARK_ID,
      ride_date: todayParkDateKey,
      speed_kmh: myTodayTopSpeed,
    };
    if (canPersistProfileSnapshot) {
      insertPayload.display_name = displayName || null;
      insertPayload.avatar_url = avatarUrl;
    }
    if (myTodayBest.photoId) {
      insertPayload.photo_id = myTodayBest.photoId;
    }

    const { error: insertError } = await sb.from('leaderboard_entries').insert(insertPayload);
    if (!insertError) {
      setLeaderboardEntries((previous) => [
        {
          id: `local-db-${currentUser.id}-${todayParkDateKey}`,
          user_id: currentUser.id,
          park_id: PLOSE_PARK_ID,
          ride_date: todayParkDateKey,
          speed_kmh: myTodayTopSpeed,
          photo_id: myTodayBest.photoId ?? null,
          display_name: canPersistProfileSnapshot ? displayName || null : null,
          avatar_url: canPersistProfileSnapshot ? avatarUrl : null,
          created_at: new Date().toISOString(),
        } as LeaderboardEntry,
        ...previous,
      ]);
      leaderboardSyncKeyRef.current = syncKey;
      if (canPersistProfileSnapshot) {
        leaderboardProfileColumnsRef.current = true;
      }
    } else if (
      canPersistProfileSnapshot &&
      typeof insertError.message === 'string' &&
      (insertError.message.includes('display_name') || insertError.message.includes('avatar_url'))
    ) {
      leaderboardProfileColumnsRef.current = false;
    }
  }, [
    currentUser,
    myTodayBest.photoId,
    myTodayTopSpeed,
    profile?.avatar_url,
    profile?.display_name,
    profileAvatarUrl,
    profileDisplayName,
    todayParkDateKey,
  ]);

  useEffect(() => {
    void syncTodayLeaderboardEntry();
  }, [syncTodayLeaderboardEntry]);

  const effectiveLeaderboardEntries = useMemo(() => {
    const rows = leaderboardEntries.map((entry) => ({ ...entry }));

    if (currentUser && myTodayTopSpeed !== null) {
      const profileName = profileDisplayName.trim();
      const storedName =
        typeof profile?.display_name === 'string' ? profile.display_name.trim() : '';
      const firstName = typeof profile?.vorname === 'string' ? profile.vorname.trim() : '';
      const lastName = typeof profile?.nachname === 'string' ? profile.nachname.trim() : '';
      const fullName = `${firstName} ${lastName}`.trim();
      const currentDisplayName = profileName || storedName || fullName || 'Fahrer/in';

      const profileAvatarCandidate = profileAvatarUrl.trim();
      const storedAvatar =
        typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '';
      const currentAvatar = resolveAvatarUrlValue(profileAvatarCandidate || storedAvatar || null);

      const currentIndex = rows.findIndex((entry) => entry.user_id === currentUser.id);
      if (currentIndex >= 0) {
        const existingSpeed =
          typeof rows[currentIndex].speed_kmh === 'number' ? rows[currentIndex].speed_kmh : 0;
        rows[currentIndex] = {
          ...rows[currentIndex],
          speed_kmh: Math.max(existingSpeed, myTodayTopSpeed),
          display_name: rows[currentIndex].display_name || currentDisplayName,
          avatar_url: rows[currentIndex].avatar_url || currentAvatar,
        };
      } else {
        rows.push({
          id: `local-${currentUser.id}-${todayParkDateKey}`,
          user_id: currentUser.id,
          park_id: PLOSE_PARK_ID,
          display_name: currentDisplayName,
          avatar_url: currentAvatar,
          speed_kmh: myTodayTopSpeed,
          ride_date: todayParkDateKey,
          created_at: new Date().toISOString(),
        });
      }
    }

    return rows
      .sort((a, b) => {
        const speedA = typeof a.speed_kmh === 'number' ? a.speed_kmh : 0;
        const speedB = typeof b.speed_kmh === 'number' ? b.speed_kmh : 0;
        return speedB - speedA;
      })
      .slice(0, 20)
      .map((entry, index) => ({
        ...entry,
        rank_position: index + 1,
      }));
  }, [currentUser, leaderboardEntries, myTodayTopSpeed, profile?.avatar_url, profile?.display_name, profileAvatarUrl, profileDisplayName, todayParkDateKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (effectiveLeaderboardEntries.length === 0) return;

    try {
      window.localStorage.setItem(
        GUEST_LEADERBOARD_CACHE_KEY,
        JSON.stringify(effectiveLeaderboardEntries.slice(0, 20))
      );
    } catch {
      // ignore storage write failures (private mode/quota)
    }
  }, [effectiveLeaderboardEntries]);

  const leaderboardOwnTopSpeed = useMemo(() => {
    if (!currentUser) return null;
    const ownEntry = effectiveLeaderboardEntries.find((entry) => entry.user_id === currentUser.id) ?? null;
    if (!ownEntry) return null;
    return typeof ownEntry.speed_kmh === 'number' ? ownEntry.speed_kmh : null;
  }, [currentUser, effectiveLeaderboardEntries]);

  const dashboardTopSpeed = useMemo(() => {
    const candidates = [myTopSpeed, myTodayTopSpeed, leaderboardOwnTopSpeed].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    if (candidates.length === 0) return null;
    return Math.max(...candidates);
  }, [leaderboardOwnTopSpeed, myTodayTopSpeed, myTopSpeed]);

  const cartItemUnitCents = useCallback((item: CartItem): number => {
    const candidates: unknown[] = [
      item.photo?.price_cents,
      (item as unknown as { price_cents?: unknown }).price_cents,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        const rounded = Math.round(candidate);
        if (rounded > 0) return rounded;
      }
      if (typeof candidate === 'string') {
        const parsed = Number(candidate.replace(',', '.').trim());
        if (Number.isFinite(parsed)) {
          const rounded = Math.round(parsed);
          if (rounded > 0) return rounded;
        }
      }
    }

    return 499;
  }, []);

  const cartItemQuantity = useCallback((item: CartItem): number => {
    const value = item.quantity;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed);
      }
    }
    return 1;
  }, []);

  const cartTotalCents = useMemo(
    () =>
      cartItems.reduce((acc, item) => {
        const unit = cartItemUnitCents(item);
        const quantity = cartItemQuantity(item);
        return acc + unit * quantity;
      }, 0) + (dayPassInCart ? DAY_PASS_PRICE_CENTS : 0),
    [cartItemQuantity, cartItemUnitCents, cartItems, dayPassInCart]
  );

  const performAuth = useCallback(async () => {
    if (!supabase) return;

    if (!authEmail || !authPassword) {
      setAuthState({
        state: 'error',
        message: null,
        error: { code: 'validation', message: 'Bitte E-Mail und Passwort ausfüllen.' },
      });
      return;
    }

    setAuthState({ state: 'loading', message: null, error: null });

    if (authMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
        options: {
          data: {
            park_id: PLOSE_PARK_ID,
            park_name: PLOSE_PARK_NAME,
          },
        },
      });
      if (error) {
        setAuthState({ state: 'error', message: null, error: toApiError(error, 'Signup fehlgeschlagen.') });
        return;
      }

      if (data.user) {
        const assignmentError = await upsertPloseUserAssignment(data.user);
        if (assignmentError) {
          setAuthState({ state: 'error', message: null, error: assignmentError });
          return;
        }
      }
      setAuthState({
        state: 'success',
        message: `Registrierung erfolgreich. Account ist ${PLOSE_PARK_NAME} zugeordnet.`,
        error: null,
      });
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    if (error) {
      setAuthState({ state: 'error', message: null, error: toApiError(error, 'Login fehlgeschlagen.') });
      return;
    }

    if (data.user) {
      const accessError = await validatePloseAccessOnLogin(data.user);
      if (accessError) {
        await supabase.auth.signOut();
        setAuthState({ state: 'error', message: null, error: accessError });
        return;
      }
    }

    setAuthState({
      state: 'success',
      message: `Erfolgreich eingeloggt. Account ist ${PLOSE_PARK_NAME} zugeordnet.`,
      error: null,
    });
  }, [authEmail, authMode, authPassword, upsertPloseUserAssignment, validatePloseAccessOnLogin]);

  const logout = useCallback(async () => {
    if (!supabase) return;

    await supabase.auth.signOut();
    setAuthState(initialMessageState());
    setAuthPassword('');
  }, []);

  const logoutFromSettings = useCallback(async () => {
    setShowSettingsDropdown(false);
    setActiveSettingsPanel(null);
    setAuthMode('login');
    await logout();

    window.setTimeout(() => {
      loginBoxRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 0);
  }, [logout]);

  const toggleFavorite = useCallback(
    async (photoId: string) => {
      if (!supabase || !currentUser) {
        promptLoginToUseFeature('Login to use this.');
        setFavoritesState({
          state: 'error',
          message: null,
          error: { code: 'auth_required', message: 'Bitte einloggen, um Favoriten zu speichern.' },
        });
        return;
      }

      setFavoritesState({ state: 'loading', message: null, error: null });

      if (favorites.has(photoId)) {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('park_id', PLOSE_PARK_ID)
          .eq('photo_id', photoId);

        if (error) {
          setFavoritesState({
            state: 'error',
            message: null,
            error: toApiError(error, 'Favorit konnte nicht entfernt werden.'),
          });
          return;
        }

        setFavorites((previous) => {
          const next = new Set(previous);
          next.delete(photoId);
          return next;
        });
      } else {
        const { error } = await supabase
          .from('favorites')
          .insert({ user_id: currentUser.id, photo_id: photoId, park_id: PLOSE_PARK_ID });

        if (error && !isDuplicateInsertError(error)) {
          setFavoritesState({
            state: 'error',
            message: null,
            error: toApiError(error, 'Favorit konnte nicht gespeichert werden.'),
          });
          return;
        }

        setFavorites((previous) => {
          const next = new Set(previous);
          next.add(photoId);
          return next;
        });
        openPromoPopup('favorite_expiry');
      }

      setFavoritesState({ state: 'success', message: null, error: null });
    },
    [currentUser, favorites, openPromoPopup, promptLoginToUseFeature]
  );

  const addToCart = useCallback(
    async (photo: Photo) => {
      if (!supabase || !currentUser) {
        promptLoginToUseFeature('Login to use this.');
        setCartState({
          state: 'error',
          message: null,
          error: { code: 'auth_required', message: 'Bitte einloggen, um Bilder in den Warenkorb zu legen.' },
        });
        return;
      }

      if (isPhotoUnlocked(photo)) {
        setCartState({
          state: 'error',
          message: null,
          error: { code: 'already_purchased', message: 'Dieses Foto ist bereits freigeschaltet.' },
        });
        return;
      }

      if (dayPassInCart) {
        setCartState({
          state: 'error',
          message: null,
          error: {
            code: 'day_pass_in_cart',
            message: 'Tagesfotopass liegt im Warenkorb. Entferne ihn zuerst für Einzelbild-Käufe.',
          },
        });
        return;
      }

      if (cartItems.some((item) => item.photo_id === photo.id)) {
        setCartState({
          state: 'success',
          message: 'Hinzugefügt.',
          error: null,
        });
        return;
      }

      setCartState({ state: 'loading', message: null, error: null });

      const { error } = await supabase
        .from('cart_items')
        .insert({ user_id: currentUser.id, photo_id: photo.id, park_id: PLOSE_PARK_ID, quantity: 1 });
      if (error && !isDuplicateInsertError(error)) {
        setCartState({ state: 'error', message: null, error: toApiError(error, 'Warenkorb konnte nicht aktualisiert werden.') });
        return;
      }

      await loadCart(currentUser.id);
      setCartState({ state: 'success', message: 'Hinzugefügt.', error: null });
    },
    [cartItems, currentUser, dayPassInCart, isPhotoUnlocked, loadCart, promptLoginToUseFeature]
  );

  const removeFromCart = useCallback(
    async (cartItemId: string) => {
      if (!supabase || !currentUser) return;

      setCartState({ state: 'loading', message: null, error: null });

      const { error } = await supabase
        .from('cart_items')
        .delete()
        .eq('id', cartItemId)
        .eq('user_id', currentUser.id)
        .eq('park_id', PLOSE_PARK_ID);
      if (error) {
        setCartState({ state: 'error', message: null, error: toApiError(error, 'Eintrag konnte nicht entfernt werden.') });
        return;
      }

      await loadCart(currentUser.id);
      setCartState({ state: 'success', message: null, error: null });
    },
    [currentUser, loadCart]
  );

  const addDayPassToCart = useCallback(async () => {
    if (!currentUser) {
      promptLoginToUseFeature('Login to use this.');
      return;
    }
    if (hasTodayDayPass) {
      setCartState({ state: 'success', message: 'Tagesfotopass wurde heute bereits gekauft.', error: null });
      return;
    }
    let removedPhotosFromCart = false;
    if (cartItems.length > 0) {
      if (!supabase) {
        setCartState({
          state: 'error',
          message: null,
          error: { code: 'supabase_missing', message: 'Supabase ist nicht konfiguriert.' },
        });
        return;
      }

      setCartState({ state: 'loading', message: null, error: null });
      const { error } = await supabase
        .from('cart_items')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('park_id', PLOSE_PARK_ID);
      if (error) {
        setCartState({ state: 'error', message: null, error: toApiError(error, 'Warenkorb konnte nicht bereinigt werden.') });
        return;
      }

      removedPhotosFromCart = true;
      await loadCart(currentUser.id);
    }

    setDayPassInCart(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(dayPassStorageKey(currentUser.id), '1');
    }
    setCartState({
      state: 'success',
      message: removedPhotosFromCart ? 'Bilder entfernt. Tagesfotopass im Warenkorb.' : 'Tagesfotopass im Warenkorb.',
      error: null,
    });
  }, [cartItems.length, currentUser, hasTodayDayPass, loadCart, promptLoginToUseFeature, supabase]);

  const removeDayPassFromCart = useCallback(() => {
    if (currentUser && typeof window !== 'undefined') {
      window.localStorage.removeItem(dayPassStorageKey(currentUser.id));
    }
    setDayPassInCart(false);
    setCartState({ state: 'success', message: 'Tagesfotopass entfernt.', error: null });
  }, [currentUser]);

  const startCheckout = useCallback(async () => {
    if (!supabase || !currentUser) {
      promptLoginToUseFeature('Login to use this.');
      setCheckoutState({
        state: 'error',
        message: null,
        error: { code: 'auth_required', message: 'Bitte einloggen, um Checkout zu starten.' },
      });
      return;
    }

    setCheckoutState({ state: 'loading', message: null, error: null });

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      setCheckoutState({
        state: 'error',
        message: null,
        error: {
          code: 'auth_required',
          message: 'Session fehlt oder ist abgelaufen. Bitte erneut einloggen und nochmal versuchen.',
        },
      });
      return;
    }
    let activeSession = sessionData.session;

    const expiresAtMs = typeof activeSession.expires_at === 'number' ? activeSession.expires_at * 1000 : null;
    if (!expiresAtMs || expiresAtMs <= Date.now() + 30_000) {
      const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshedData.session) {
        activeSession = refreshedData.session;
      }
    }

    const { data: activeUser, error: activeUserError } = await supabase.auth.getUser();
    if (activeUserError || !activeUser.user) {
      const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshedData.session) {
        setCheckoutState({
          state: 'error',
          message: null,
          error: {
            code: 'invalid_jwt',
            message:
              'Deine Session ist ungueltig/abgelaufen. Bitte neu einloggen und Checkout erneut starten.',
          },
        });
        return;
      }
      activeSession = refreshedData.session;
    }

    const accessToken = activeSession.access_token;

    if (cartItems.length === 0 && !dayPassInCart) {
      setCheckoutState({
        state: 'error',
        message: null,
        error: {
          code: 'empty_cart',
          message: 'Der Warenkorb ist leer.',
        },
      });
      return;
    }

    const successUrl = `${window.location.origin}${window.location.pathname}?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${window.location.origin}${window.location.pathname}?checkout=cancel`;

    const toPositiveInt = (value: unknown, fallback: number): number => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        const rounded = Math.round(value);
        return rounded > 0 ? rounded : fallback;
      }
      if (typeof value === 'string') {
        const normalized = value.replace(',', '.').trim();
        const parsed = Number(normalized);
        if (Number.isFinite(parsed)) {
          const rounded = Math.round(parsed);
          return rounded > 0 ? rounded : fallback;
        }
      }
      return fallback;
    };

    const checkoutItems: NonNullable<CheckoutRequest['items']> = cartItems.map((item) => {
      const rawPriceCents = (item.photo?.price_cents as unknown) ?? 499;
      const unitCents = toPositiveInt(rawPriceCents, 499);
      const quantity = toPositiveInt(item.quantity, 1);
      const photoLabel = `Foto ${item.photo_id.slice(0, 8)}`;
      const priceEuro = Number((unitCents / 100).toFixed(2));
      return {
        photoId: item.photo_id,
        photo_id: item.photo_id,
        price: priceEuro,
        price_cents: unitCents,
        priceCents: unitCents,
        unit_amount: unitCents,
        unitAmount: unitCents,
        amount_cents: unitCents,
        amountCents: unitCents,
        quantity,
        type: 'photo',
        name: photoLabel,
        description: `${photoLabel} Plosebob`,
        parkId: PLOSE_PARK_ID,
        park_id: PLOSE_PARK_ID,
      };
    });
    if (dayPassInCart) {
      checkoutItems.push({
        price: Number((DAY_PASS_PRICE_CENTS / 100).toFixed(2)),
        price_cents: DAY_PASS_PRICE_CENTS,
        priceCents: DAY_PASS_PRICE_CENTS,
        unit_amount: DAY_PASS_PRICE_CENTS,
        unitAmount: DAY_PASS_PRICE_CENTS,
        amount_cents: DAY_PASS_PRICE_CENTS,
        amountCents: DAY_PASS_PRICE_CENTS,
        quantity: 1,
        type: 'day_pass',
        name: 'Tagesfotopass',
        description: 'Alle deine Fahrten heute ohne Einzelkauf',
        parkId: PLOSE_PARK_ID,
        park_id: PLOSE_PARK_ID,
      });
    }

    const invalidItem = checkoutItems.find((item) => {
      const cents =
        typeof item.unit_amount === 'number'
          ? item.unit_amount
          : typeof item.price_cents === 'number'
            ? item.price_cents
            : NaN;
      return !Number.isFinite(cents) || cents <= 0 || Math.floor(cents) !== cents;
    });

    if (invalidItem) {
      setCheckoutState({
        state: 'error',
        message: null,
        error: {
          code: 'invalid_checkout_amount',
          message: 'Ungültiger Preiswert erkannt (NaN/leer). Bitte Seite neu laden und erneut versuchen.',
          details: invalidItem,
        },
      });
      return;
    }

    const request: CheckoutRequest = {
      success_url: successUrl,
      cancel_url: cancelUrl,
      mode: 'payment',
      park_id: PLOSE_PARK_ID,
      parkId: PLOSE_PARK_ID,
      successUrl,
      cancelUrl,
      items: checkoutItems,
      cart_item_ids: cartItems.map((item) => item.id),
      photo_ids: cartItems.map((item) => item.photo_id),
      ...(selectedRideId ? { ride_id: selectedRideId } : {}),
    };

    const primary = await supabase.functions.invoke<CheckoutResponse>('cart-checkout', {
      body: request,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (primary.error) {
      const detailedMessage = await getFunctionErrorMessage(
        primary.error,
        'Checkout konnte nicht gestartet werden.'
      );
      const lower = detailedMessage.toLowerCase();

      if (lower.includes('invalid jwt') || lower.includes('failed to authenticate user')) {
        setCheckoutState({
          state: 'error',
          message: null,
          error: {
            code: 'invalid_jwt',
            message:
              'Deine Session ist ungueltig/abgelaufen. Bitte neu einloggen und Checkout erneut starten.',
          },
        });
        return;
      }
      setCheckoutState({
        state: 'error',
        message: null,
        error: {
          code: 'checkout_error',
          message: detailedMessage,
          details: primary.error,
        },
      });
      return;
    }

    const responseData: CheckoutResponse | null = primary.data ?? null;

    if (!responseData) {
      setCheckoutState({
        state: 'error',
        message: null,
        error: {
          code: 'empty_checkout_response',
          message: 'Checkout-Function hat keine Daten zurückgegeben.',
        },
      });
      return;
    }

    const responseRecord =
      responseData && typeof responseData === 'object'
        ? (responseData as Record<string, unknown>)
        : null;
    const nestedData =
      responseRecord && typeof responseRecord.data === 'object' && responseRecord.data !== null
        ? (responseRecord.data as Record<string, unknown>)
        : null;
    const nestedSession =
      responseRecord && typeof responseRecord.session === 'object' && responseRecord.session !== null
        ? (responseRecord.session as Record<string, unknown>)
        : null;

    const redirectUrlCandidates: Array<unknown> = [
      responseData?.checkout_url,
      responseData?.url,
      responseRecord?.checkoutUrl,
      responseRecord?.checkout_url,
      responseRecord?.session_url,
      responseRecord?.sessionUrl,
      nestedData?.checkout_url,
      nestedData?.checkoutUrl,
      nestedData?.url,
      nestedSession?.url,
    ];
    const redirectUrl =
      redirectUrlCandidates.find(
        (value): value is string => typeof value === 'string' && value.startsWith('http')
      ) ?? null;

    if (redirectUrl) {
      if (typeof window !== 'undefined' && cartItems.length > 0) {
        const photoIdsForPending = [...new Set(
          cartItems
            .map((item) => (typeof item.photo_id === 'string' ? item.photo_id : null))
            .filter((id): id is string => Boolean(id))
        )];
        if (photoIdsForPending.length > 0) {
          window.localStorage.setItem(
            pendingCheckoutStorageKey(currentUser.id),
            JSON.stringify({
              photoIds: photoIdsForPending,
              createdAt: Date.now(),
            })
          );
        }
      }
      window.location.href = redirectUrl;
      return;
    }

    const responseSummary = JSON.stringify(responseData);
    setCheckoutState({
      state: 'error',
      message: null,
      error: {
        code: 'checkout_missing_redirect',
        message: `Checkout-Response ohne Redirect-URL. Response: ${responseSummary}`,
      },
    });

    await Promise.all([loadCart(currentUser.id), loadPurchasesAndUnlocks(currentUser.id), loadLeaderboard()]);
  }, [
    cartItems,
    currentUser,
    dayPassInCart,
    loadCart,
    loadLeaderboard,
    loadPurchasesAndUnlocks,
    promptLoginToUseFeature,
    selectedRideId,
  ]);

  const saveProfile = useCallback(
    async (options?: { displayName?: string; avatarUrl?: string | null; successMessage?: string }) => {
      if (!supabase || !currentUser) return;

      setProfileState({ state: 'loading', message: null, error: null });

      const nextDisplayName = normalizePersonName(options?.displayName ?? profileDisplayName);
      const nextAvatarRaw = options?.avatarUrl ?? profileAvatarUrl;
      const nextAvatarUrl = typeof nextAvatarRaw === 'string' ? nextAvatarRaw.trim() || null : null;
      const { vorname, nachname } = splitDisplayNameIntoNameParts(nextDisplayName);

      const payload = {
        id: currentUser.id,
        email: currentUser.email ?? null,
        park_id: PLOSE_PARK_ID,
        vorname,
        nachname,
        avatar_url: nextAvatarUrl,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('users')
        .upsert(payload, { onConflict: 'id' })
        .select('*')
        .maybeSingle();

      if (error) {
        setProfileState({
          state: 'error',
          message: null,
          error: toApiError(error, 'Profil speichern fehlgeschlagen.'),
        });
        return;
      }

      // Keep auth metadata in sync for other consumers using auth.user metadata.
      await supabase.auth.updateUser({
        data: {
          display_name: nextDisplayName ?? '',
          avatar_url: nextAvatarUrl ?? '',
        },
      });

      const persisted = (data as UserProfile | null) ?? payload;
      const persistedDisplayName = resolveProfileDisplayName(persisted) || nextDisplayName;
      const persistedAvatarUrl =
        (typeof persisted.avatar_url === 'string' ? persisted.avatar_url : nextAvatarUrl) ?? '';
      setProfile({
        ...persisted,
        display_name: persistedDisplayName,
        avatar_url: persistedAvatarUrl,
      });
      setProfileDisplayName(persistedDisplayName);
      setProfileAvatarUrl(persistedAvatarUrl);
      setProfileState({
        state: 'success',
        message: options?.successMessage ?? 'Profil gespeichert.',
        error: null,
      });
    },
    [currentUser, profileAvatarUrl, profileDisplayName]
  );

  const removeProfileAvatar = useCallback(async () => {
    setProfileAvatarUrl('');
    await saveProfile({ avatarUrl: '', successMessage: 'Profilbild entfernt.' });
  }, [saveProfile]);

  const handleAvatarFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!supabase || !currentUser) {
        event.target.value = '';
        return;
      }

      if (!file.type.startsWith('image/')) {
        setProfileState({
          state: 'error',
          message: null,
          error: { code: 'invalid_file_type', message: 'Bitte ein Bild auswählen (JPG/PNG/WebP).' },
        });
        event.target.value = '';
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setProfileState({
          state: 'error',
          message: null,
          error: { code: 'file_too_large', message: 'Bild ist zu groß (max. 10 MB).' },
        });
        event.target.value = '';
        return;
      }

      setProfileState({ state: 'loading', message: null, error: null });

      const extCandidate = file.name.split('.').pop()?.toLowerCase() ?? '';
      const ext = /^[a-z0-9]+$/.test(extCandidate) ? extCandidate : 'jpg';
      const objectPath = `${currentUser.id}/avatar.${ext}`;

      const { error } = await supabase.storage.from(PLOSE_AVATAR_BUCKET).upload(objectPath, file, {
        upsert: true,
        cacheControl: '3600',
        contentType: file.type,
      });

      if (error) {
        setProfileState({
          state: 'error',
          message: null,
          error: toApiError(error, 'Profilbild-Upload fehlgeschlagen.'),
        });
        event.target.value = '';
        return;
      }

      const avatarStoragePath = `${PLOSE_AVATAR_BUCKET}/${objectPath}`;
      setProfileAvatarUrl(avatarStoragePath);
      await saveProfile({
        avatarUrl: avatarStoragePath,
        successMessage: 'Profilbild aktualisiert.',
      });
      event.target.value = '';
    },
    [currentUser, saveProfile]
  );

  const changePassword = useCallback(async () => {
    if (!supabase || !newPassword) {
      setProfileState({
        state: 'error',
        message: null,
        error: { code: 'validation', message: 'Bitte ein neues Passwort eingeben.' },
      });
      return;
    }

    setProfileState({ state: 'loading', message: null, error: null });

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setProfileState({ state: 'error', message: null, error: toApiError(error, 'Passwort-Update fehlgeschlagen.') });
      return;
    }

    setNewPassword('');
    setProfileState({ state: 'success', message: 'Passwort aktualisiert.', error: null });
  }, [newPassword]);

  const updateNewsletter = useCallback(
    async (subscribed: boolean): Promise<boolean> => {
      if (!supabase || !currentUser) return false;

      setNewsletterState({ state: 'loading', message: null, error: null });

      const payload: NewsletterSubscription = {
        user_id: currentUser.id,
        park_id: PLOSE_PARK_ID,
        email: currentUser.email ?? '',
        subscribed,
        popup_enabled: newsletter?.popup_enabled ?? profile?.popup_enabled ?? true,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('newsletter_subscriptions')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .maybeSingle();

      if (error) {
        setNewsletterState({
          state: 'error',
          message: null,
          error: toApiError(error, 'Newsletter-Einstellung konnte nicht gespeichert werden.'),
        });
        return false;
      }

      const resolvedNewsletter = (data as NewsletterSubscription | null) ?? payload;
      setNewsletter(resolvedNewsletter);
      if (typeof resolvedNewsletter.popup_enabled === 'boolean') {
        setProfile((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            popup_enabled: resolvedNewsletter.popup_enabled,
          };
        });
      }
      setNewsletterState({ state: 'success', message: 'Newsletter-Einstellung aktualisiert.', error: null });
      return true;
    },
    [currentUser, newsletter?.popup_enabled, profile?.popup_enabled]
  );

  const subscribeFromPopup = useCallback(async () => {
    if (newsletterPopupSubmitting) return;
    setNewsletterPopupSubmitting(true);
    const success = await updateNewsletter(true);
    setNewsletterPopupSubmitting(false);
    if (!success) return;
    setNewsletterPopupThanks(true);
    window.setTimeout(() => {
      closePromoPopup();
    }, 1400);
  }, [closePromoPopup, newsletterPopupSubmitting, updateNewsletter]);

  const updatePopupEnabled = useCallback(
    async (popupEnabled: boolean) => {
      if (!supabase || !currentUser) return;

      setNewsletterState({ state: 'loading', message: null, error: null });

      const payload: NewsletterSubscription = {
        user_id: currentUser.id,
        park_id: PLOSE_PARK_ID,
        email: currentUser.email ?? '',
        subscribed: newsletter?.subscribed ?? false,
        popup_enabled: popupEnabled,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('newsletter_subscriptions')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .maybeSingle();

      if (error) {
        setNewsletterState({
          state: 'error',
          message: null,
          error: toApiError(error, 'Popup-Einstellung konnte nicht gespeichert werden.'),
        });
        return;
      }

      setNewsletter((data as NewsletterSubscription | null) ?? payload);
      setProfile((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          popup_enabled: popupEnabled,
        };
      });
      setNewsletterState({ state: 'success', message: 'Popup-Einstellung gespeichert.', error: null });
    },
    [currentUser, newsletter?.subscribed]
  );

  const requestDeleteOtp = useCallback(async () => {
    if (!supabase || !currentUser) return;

    const email = currentUser.email?.toLowerCase() ?? '';
    if (!deleteEmailConfirm || deleteEmailConfirm.toLowerCase() !== email) {
      setDeleteState({
        state: 'error',
        message: null,
        error: { code: 'validation', message: 'Bitte exakt die Konto-E-Mail bestätigen.' },
      });
      return;
    }

    setDeleteState({ state: 'loading', message: null, error: null });

    const { error } = await supabase.auth.reauthenticate();
    if (error) {
      setDeleteState({
        state: 'error',
        message: null,
        error: toApiError(error, 'OTP konnte nicht angefordert werden.'),
      });
      return;
    }

    setDeleteOtp('');
    setDeleteOtpVerified(false);
    setDeleteState({
      state: 'success',
      message: 'Bestätigungscode wurde per E-Mail versendet.',
      error: null,
    });
  }, [currentUser, deleteEmailConfirm]);

  const verifyDeleteOtp = useCallback(async () => {
    if (!supabase || !currentUser) return;

    if (!deleteOtp) {
      setDeleteState({
        state: 'error',
        message: null,
        error: { code: 'validation', message: 'Bitte den E-Mail-Code eingeben.' },
      });
      return;
    }

    setDeleteState({ state: 'loading', message: null, error: null });

    const { error } = await supabase.auth.verifyOtp({
      email: currentUser.email ?? '',
      token: deleteOtp,
      type: 'email',
    });

    if (error) {
      setDeleteState({
        state: 'error',
        message: null,
        error: toApiError(error, 'E-Mail-Code ungültig oder abgelaufen.'),
      });
      return;
    }

    setDeleteOtpVerified(true);
    setDeleteState({ state: 'success', message: 'E-Mail-Bestätigung erfolgreich.', error: null });
  }, [currentUser, deleteOtp]);

  const performAccountDelete = useCallback(async () => {
    if (!supabase || !currentUser) return;

    const expectedEmail = currentUser.email?.toLowerCase() ?? '';
    const confirmedEmail = deleteEmailConfirm.toLowerCase();

    if (!deleteOtpVerified) {
      setDeleteState({
        state: 'error',
        message: null,
        error: { code: 'otp_required', message: 'Bitte zuerst den E-Mail-Code verifizieren.' },
      });
      return;
    }

    if (confirmedEmail !== expectedEmail) {
      setDeleteState({
        state: 'error',
        message: null,
        error: { code: 'email_mismatch', message: 'Bestätigte E-Mail passt nicht zum Konto.' },
      });
      return;
    }

    if (deletePhrase.trim().toUpperCase() !== 'DELETE') {
      setDeleteState({
        state: 'error',
        message: null,
        error: { code: 'confirmation_phrase', message: 'Bitte DELETE eintippen, um zu bestätigen.' },
      });
      return;
    }

    setDeleteState({ state: 'loading', message: null, error: null });

    const payload: DeleteAccountRequest = {
      email: currentUser.email ?? '',
      otp: deleteOtp,
      reason: deleteReason || undefined,
    };

    const { data, error } = await supabase.functions.invoke<DeleteAccountResponse>('delete-account', {
      body: payload,
    });

    if (error) {
      setDeleteState({
        state: 'error',
        message: null,
        error: toApiError(error, 'Account-Löschung fehlgeschlagen.'),
      });
      return;
    }

    if (data && data.success === false) {
      setDeleteState({
        state: 'error',
        message: null,
        error: {
          code: 'delete_rejected',
          message: data.message ?? 'Delete-Function hat die Löschung abgelehnt.',
        },
      });
      return;
    }

    await supabase.auth.signOut();

    setDeleteState({
      state: 'success',
      message: 'Konto wurde zur Löschung übergeben und du wurdest ausgeloggt.',
      error: null,
    });
  }, [currentUser, deleteEmailConfirm, deleteOtp, deleteOtpVerified, deletePhrase, deleteReason]);

  const formatPhotoDateTime = useCallback((photo: Photo) => {
    const raw =
      (typeof photo.captured_at === 'string' && photo.captured_at) ||
      (typeof photo.created_at === 'string' && photo.created_at) ||
      (typeof photo.ride_date === 'string' && photo.ride_date) ||
      '';
    if (!raw) return 'Zeit n/a';

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return 'Zeit n/a';

    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(parsed);
  }, []);

  const sharePhoto = useCallback(async (photo: Photo) => {
    setShareMenuPhoto(photo);
  }, []);

  const shareToPlatform = useCallback(async (platform: 'instagram' | 'x' | 'tiktok' | 'facebook') => {
    if (!shareMenuPhoto) return;

    const url = resolvePhotoUrl(shareMenuPhoto, resolvedPhotoUrls[shareMenuPhoto.id]);
    if (!url) {
      window.alert('Bild-Link konnte nicht ermittelt werden.');
      return;
    }

    const message = 'Mein Plosebob-Moment';
    const encodedUrl = encodeURIComponent(url);
    const encodedMessage = encodeURIComponent(message);
    const openWeb = (webUrl: string) => {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    };

    if (platform === 'instagram') {
      openWeb('https://www.instagram.com/');
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => undefined);
      }
      window.alert('Link kopiert. Bitte in Instagram einfügen.');
    } else if (platform === 'x') {
      openWeb(`https://x.com/intent/tweet?text=${encodedMessage}&url=${encodedUrl}`);
    } else if (platform === 'tiktok') {
      openWeb('https://www.tiktok.com/upload');
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => undefined);
      }
      window.alert('Link kopiert. Bitte in TikTok einfügen.');
    } else if (platform === 'facebook') {
      openWeb(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`);
    }
    setShareMenuPhoto(null);
  }, [resolvedPhotoUrls, shareMenuPhoto]);

  const nativeShareFallback = useCallback(async () => {
    if (!shareMenuPhoto) return;

    const url = resolvePhotoUrl(shareMenuPhoto, resolvedPhotoUrls[shareMenuPhoto.id]);
    if (!url) {
      window.alert('Bild-Link konnte nicht ermittelt werden.');
      return;
    }

    if (navigator.share) {
      await navigator
        .share({
          title: 'Plosebob Foto',
          text: 'Mein Plosebob-Moment',
          url,
        })
        .catch(() => undefined);
      setShareMenuPhoto(null);
      return;
    }

    await navigator.clipboard.writeText(url);
    window.alert('Foto-Link wurde in die Zwischenablage kopiert.');
    setShareMenuPhoto(null);
  }, [resolvedPhotoUrls, shareMenuPhoto]);

  const downloadPhoto = useCallback(async (photo: Photo) => {
    const url = resolvePhotoUrl(photo, resolvedPhotoUrls[photo.id]);
    if (!url) {
      window.alert('Download-Link konnte nicht ermittelt werden.');
      return;
    }

    const extFromPath = (() => {
      const source =
        (typeof photo.storage_path === 'string' && photo.storage_path) ||
        (typeof photo.image_url === 'string' && photo.image_url) ||
        '';
      const clean = source.split('?')[0] ?? source;
      const match = clean.match(/\.([a-zA-Z0-9]+)$/);
      return match?.[1]?.toLowerCase() || 'jpg';
    })();

    const timestamp =
      (typeof photo.captured_at === 'string' && photo.captured_at) ||
      (typeof photo.created_at === 'string' && photo.created_at) ||
      new Date().toISOString();
    const safeDate = timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const filename = `plosebob-${photo.id}-${safeDate}.${extFromPath}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      return;
    } catch {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }, [resolvedPhotoUrls]);

  const isEnvReady = Boolean(supabase);

  const statusText = (state: MessageState): string | null => {
    if (state.error) return state.error.message;
    return state.message;
  };

  const selectedRideName = useMemo(
    () => rides.find((ride) => ride.id === selectedRideId)?.name ?? (selectedRideId ? `Ride ${selectedRideId.slice(0, 8)}` : 'Alle Rides'),
    [rides, selectedRideId]
  );

  const isTimeSearchActive = Boolean(currentUser && showGalleryFilters && selectedTime);

  const galleryPreviewPhotos = useMemo(() => {
    if (photos.length <= 3) return photos;
    if (!currentUser) return photos.slice(0, 3);
    if (!isTimeSearchActive) return photos.slice(0, 3);
    return showAllGalleryPhotos ? photos : photos.slice(0, 3);
  }, [currentUser, isTimeSearchActive, photos, showAllGalleryPhotos]);

  const hiddenGalleryPhotoCount = Math.max(photos.length - galleryPreviewPhotos.length, 0);
  const accountAvatarUrl = resolveAvatarUrlValue(
    profileAvatarUrl.trim() ||
      (typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '') ||
      null
  );

  return (
    <section id="calendar" className="py-20 bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12 observe-scroll opacity-0">
          <h2 className="text-4xl font-bold text-gray-800 mb-6">Bildkalender Shop</h2>
          <p className="text-lg text-gray-600 max-w-4xl mx-auto">
            Voller Shop-Flow direkt auf der Seite: Login, Galerie, Favoriten, Warenkorb, Checkout, Käufe,
            Ranking, Profil, Newsletter und sicherer Account-Delete mit E-Mail-Bestätigung.
          </p>
        </div>

        {!isEnvReady && (
          <div className="bg-amber-50 border border-amber-300 text-amber-800 p-4 mb-8 rounded-md flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5" />
            <p>{supabaseConfigError}</p>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {(!currentUser || (currentUser && activeSettingsPanel)) &&
              (currentUser && activeSettingsPanel ? (
              <div ref={loginBoxRef} className="bg-white border border-gray-200 shadow-sm p-6 clip-corner">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">
                      {activeSettingsPanel === 'account'
                        ? '1. Login & Account'
                        : activeSettingsPanel === 'profile'
                        ? '5. Profil & Sicherheit'
                        : activeSettingsPanel === 'newsletter'
                          ? '6. Newsletter & Popup'
                          : '7. Account löschen (E-Mail-Bestätigung)'}
                    </h3>
                    <p className="text-sm text-gray-600">Geöffnet über das Einstellungen-Menü im Warenkorb.</p>
                  </div>
                  <button
                    onClick={() => setActiveSettingsPanel(null)}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    Zurück
                  </button>
                </div>
                <input
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    void handleAvatarFileChange(event);
                  }}
                />

                {activeSettingsPanel === 'account' && (
                  <>
                    <div className="flex items-start gap-3 bg-green-50 border border-green-200 p-4">
                      <CheckCircle2 className="h-5 w-5 text-green-700 mt-0.5" />
                      <div>
                        <p className="text-green-800 font-semibold">Angemeldet als {currentUser.email}</p>
                        <p className="text-sm text-green-700">Konto aktiv.</p>
                      </div>
                    </div>
                    <div className="mt-4 border border-gray-200 p-4">
                      <p className="text-sm text-gray-700 mb-3">Profilbild & Anzeigename</p>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-14 w-14 rounded-full overflow-hidden border border-gray-300 bg-slate-100 flex items-center justify-center text-slate-500">
                          {accountAvatarUrl ? (
                            <img src={accountAvatarUrl} alt="Profilbild" className="h-full w-full object-cover" />
                          ) : (
                            <UserCircle2 className="h-7 w-7" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">
                            {profileDisplayName.trim() ||
                              (typeof profile?.display_name === 'string' ? profile.display_name.trim() : '') ||
                              currentUser.email?.split('@')[0] ||
                              'Fahrer/in'}
                          </p>
                          <p className="text-xs text-gray-600 truncate">{currentUser.email}</p>
                        </div>
                      </div>
                      <div className="grid md:grid-cols-1 gap-3">
                        <label className="text-sm text-gray-700">
                          Display Name
                          <input
                            value={profileDisplayName}
                            onChange={(event) => setProfileDisplayName(event.target.value)}
                            type="text"
                            className="w-full border border-gray-300 px-3 py-2 mt-1"
                            placeholder="Dein Name"
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => avatarFileInputRef.current?.click()}
                          className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                        >
                          Profilbild auswählen
                        </button>
                        <button
                          onClick={() => {
                            void saveProfile();
                          }}
                          className="px-4 py-2 bg-[#9B8B3E] text-white hover:bg-[#8A7A35] inline-flex items-center gap-2"
                        >
                          <UserCircle2 className="h-4 w-4" />
                          Profil speichern
                        </button>
                        <button
                          onClick={() => {
                            void removeProfileAvatar();
                          }}
                          className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                        >
                          Profilbild löschen
                        </button>
                      </div>
                      {statusText(profileState) && (
                        <p className={`text-sm mt-3 ${profileState.error ? 'text-red-600' : 'text-green-700'}`}>{statusText(profileState)}</p>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          void logoutFromSettings();
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        <LogOut className="h-4 w-4" />
                        Ausloggen
                      </button>
                      <button
                        onClick={() => openSettingsPanel('profile')}
                        className="px-4 py-2 bg-[#9B8B3E] text-white hover:bg-[#8A7A35]"
                      >
                        Profil & Sicherheit öffnen
                      </button>
                    </div>
                  </>
                )}

                {activeSettingsPanel === 'profile' && (
                  <>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-14 w-14 rounded-full overflow-hidden border border-gray-300 bg-slate-100 flex items-center justify-center text-slate-500">
                        {accountAvatarUrl ? (
                          <img src={accountAvatarUrl} alt="Profilbild" className="h-full w-full object-cover" />
                        ) : (
                          <UserCircle2 className="h-7 w-7" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">
                          {profileDisplayName.trim() ||
                            (typeof profile?.display_name === 'string' ? profile.display_name.trim() : '') ||
                            currentUser.email?.split('@')[0] ||
                            'Fahrer/in'}
                        </p>
                        <p className="text-xs text-gray-600 truncate">{currentUser.email}</p>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-1 gap-4">
                      <label className="text-sm text-gray-700">
                        Display Name
                        <input
                          value={profileDisplayName}
                          onChange={(event) => setProfileDisplayName(event.target.value)}
                          type="text"
                          className="w-full border border-gray-300 px-3 py-2 mt-1"
                          placeholder="Dein Name"
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => avatarFileInputRef.current?.click()}
                        className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Profilbild auswählen
                      </button>
                      <button
                        onClick={() => {
                          void saveProfile();
                        }}
                        className="px-4 py-2 bg-[#9B8B3E] text-white hover:bg-[#8A7A35] inline-flex items-center gap-2"
                      >
                        <UserCircle2 className="h-4 w-4" />
                        Profil speichern
                      </button>
                      <button
                        onClick={() => {
                          void removeProfileAvatar();
                        }}
                        className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Profilbild löschen
                      </button>
                    </div>

                    <div className="mt-6 border-t border-gray-200 pt-6">
                      <h4 className="font-semibold text-gray-900 mb-2">Account Security</h4>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          type="password"
                          className="w-full border border-gray-300 px-3 py-2"
                          placeholder="Neues Passwort"
                        />
                        <button
                          onClick={() => {
                            void changePassword();
                          }}
                          className="px-4 py-2 border border-[#1E3A5F] text-[#1E3A5F] hover:bg-slate-50 inline-flex items-center justify-center gap-2"
                        >
                          <ShieldAlert className="h-4 w-4" />
                          Passwort ändern
                        </button>
                      </div>
                    </div>

                    {statusText(profileState) && (
                      <p className={`text-sm mt-3 ${profileState.error ? 'text-red-600' : 'text-green-700'}`}>{statusText(profileState)}</p>
                    )}
                  </>
                )}

                {activeSettingsPanel === 'newsletter' && (
                  <>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="border border-gray-200 p-4">
                        <p className="font-semibold text-gray-900 mb-2 inline-flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          Newsletter
                        </p>
                        <p className="text-sm text-gray-600 mb-3">Updates und Angebote per E-Mail erhalten.</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              void updateNewsletter(true);
                            }}
                            className={`px-3 py-2 border ${newsletter?.subscribed ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]' : 'border-gray-300 text-gray-700'}`}
                          >
                            Subscribe
                          </button>
                          <button
                            onClick={() => {
                              void updateNewsletter(false);
                            }}
                            className={`px-3 py-2 border ${newsletter?.subscribed ? 'border-gray-300 text-gray-700' : 'bg-[#1E3A5F] text-white border-[#1E3A5F]'}`}
                          >
                            Unsubscribe
                          </button>
                        </div>
                      </div>
                      <div className="border border-gray-200 p-4">
                        <p className="font-semibold text-gray-900 mb-2 inline-flex items-center gap-2">
                          <Bell className="h-4 w-4" />
                          Popup anzeigen
                        </p>
                        <p className="text-sm text-gray-600 mb-3">Steuert den persistenten Popup-Opt-in je Nutzer.</p>
                        <button
                          onClick={() => {
                            void updatePopupEnabled(!(profile?.popup_enabled ?? true));
                          }}
                          className="px-3 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                        >
                          {profile?.popup_enabled ?? true ? 'Aktiviert' : 'Deaktiviert'}
                        </button>
                      </div>
                    </div>
                    {statusText(newsletterState) && (
                      <p className={`text-sm mt-3 ${newsletterState.error ? 'text-red-600' : 'text-green-700'}`}>{statusText(newsletterState)}</p>
                    )}
                  </>
                )}

                {activeSettingsPanel === 'delete' && (
                  <>
                    <p className="text-sm text-red-700 mb-4">
                      Sicherer Delete-Flow: E-Mail bestätigen, OTP aus E-Mail verifizieren, dann Löschung an
                      `delete-account` Function senden.
                    </p>

                    <div className="grid md:grid-cols-2 gap-3 mb-3">
                      <label className="text-sm text-gray-700">
                        Konto-E-Mail bestätigen
                        <input
                          type="email"
                          value={deleteEmailConfirm}
                          onChange={(event) => setDeleteEmailConfirm(event.target.value)}
                          className="w-full border border-gray-300 px-3 py-2 mt-1"
                          placeholder="deine@email.de"
                        />
                      </label>
                      <label className="text-sm text-gray-700">
                        E-Mail OTP Code
                        <input
                          type="text"
                          value={deleteOtp}
                          onChange={(event) => setDeleteOtp(event.target.value.trim())}
                          className="w-full border border-gray-300 px-3 py-2 mt-1"
                          placeholder="123456"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-3">
                      <button
                        onClick={() => {
                          void requestDeleteOtp();
                        }}
                        className="px-4 py-2 border border-red-300 text-red-800 hover:bg-red-50"
                      >
                        Code per E-Mail senden
                      </button>
                      <button
                        onClick={() => {
                          void verifyDeleteOtp();
                        }}
                        className="px-4 py-2 border border-red-300 text-red-800 hover:bg-red-50"
                      >
                        OTP verifizieren
                      </button>
                    </div>

                    <label className="text-sm text-gray-700 block mb-3">
                      Optionaler Grund
                      <textarea
                        value={deleteReason}
                        onChange={(event) => setDeleteReason(event.target.value)}
                        rows={2}
                        className="w-full border border-gray-300 px-3 py-2 mt-1"
                      />
                    </label>

                    <label className="text-sm text-gray-700 block mb-4">
                      Tippe <span className="font-semibold">DELETE</span> zur finalen Bestätigung
                      <input
                        type="text"
                        value={deletePhrase}
                        onChange={(event) => setDeletePhrase(event.target.value)}
                        className="w-full border border-gray-300 px-3 py-2 mt-1"
                        placeholder="DELETE"
                      />
                    </label>

                    <button
                      onClick={() => {
                        void performAccountDelete();
                      }}
                      disabled={!deleteOtpVerified || deletePhrase.trim().toUpperCase() !== 'DELETE'}
                      className="px-5 py-2 bg-red-700 text-white hover:bg-red-800 disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Account endgültig löschen
                    </button>

                    <div className="mt-3 text-sm">
                      {deleteOtpVerified && <p className="text-green-700">OTP verifiziert.</p>}
                      {statusText(deleteState) && (
                        <p className={deleteState.error ? 'text-red-700' : 'text-green-700'}>{statusText(deleteState)}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div
                ref={loginBoxRef}
                className={`bg-white border shadow-sm p-6 clip-corner transition-all ${
                  loginAttention ? 'border-[#9B8B3E] ring-2 ring-[#9B8B3E]/60' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">1. Login & Account</h3>
                    <p className="text-sm text-gray-600">Login oder Account erstellen.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {loginAttentionMessage && (
                    <div className="border border-[#9B8B3E] bg-[#F9F4DF] text-[#6C5D21] px-3 py-2 text-sm font-medium">
                      {loginAttentionMessage}
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      type="email"
                      placeholder="E-Mail"
                      className="w-full border border-gray-300 px-3 py-2"
                    />
                    <input
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      type="password"
                      placeholder="Passwort"
                      className="w-full border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setAuthMode((previous) => (previous === 'login' ? 'signup' : 'login'))}
                      className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                    >
                      {authMode === 'login' ? 'Noch kein Konto? Account erstellen' : 'Schon registriert? Zum Login'}
                    </button>
                    <button
                      onClick={() => {
                        void performAuth();
                      }}
                      disabled={!isEnvReady || authState.state === 'loading'}
                      className="px-5 py-2 bg-[#9B8B3E] text-white hover:bg-[#8A7A35] disabled:opacity-60 inline-flex items-center gap-2"
                    >
                      {authState.state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      {authMode === 'login' ? 'Weiter' : 'Account erstellen'}
                    </button>
                  </div>
                  {statusText(authState) && (
                    <p className={`text-sm ${authState.error ? 'text-red-600' : 'text-green-700'}`}>{statusText(authState)}</p>
                  )}
                </div>
              </div>
            ))}

            {!(currentUser && activeSettingsPanel) && (
            <>
            <div ref={gallerySectionRef} className="bg-white border border-gray-200 shadow-sm p-6 clip-corner">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">2. Galerie</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      if (!currentUser) {
                        promptLoginToUseFeature('Login to use this.');
                        return;
                      }
                      setShowGalleryFilters((previous) => !previous);
                    }}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-[#9B8B3E] text-white hover:bg-[#8A7A35]"
                  >
                    {showGalleryFilters ? 'Kalender schließen' : 'Finde mein Foto'}
                  </button>
                  <button
                    onClick={() => {
                      void Promise.all([
                        loadRides(),
                        loadPhotos(),
                        ...(currentUser
                          ? [loadCart(currentUser.id), loadPurchasesAndUnlocks(currentUser.id), loadLeaderboard()]
                          : []),
                      ]);
                    }}
                    className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Aktualisieren
                  </button>
                </div>
              </div>

              {showGalleryFilters ? (
                <>
                  <div className="mb-3">
                    <label className="text-sm text-gray-700">
                      Datum
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(event) => setSelectedDate(event.target.value)}
                        className="w-full border border-gray-300 px-3 py-2 mt-1"
                      />
                    </label>
                  </div>
                  <div className="mb-4">
                    <label className="text-sm text-gray-700">
                      Zeit (Pflicht)
                      <input
                        type="time"
                        value={selectedTime}
                        onChange={(event) => {
                          const value = event.target.value;
                          setSelectedTime(value);
                          if (value && !selectedDate) {
                            setSelectedDate(toLocalDateInputValue());
                          }
                        }}
                        className="w-full border border-gray-300 px-3 py-2 mt-1"
                      />
                    </label>
                    <p className="text-xs text-gray-500 mt-1">Zeigt automatisch Fotos aus den letzten 7 Minuten bis zur gewählten Uhrzeit.</p>
                  </div>
                  <div className="mb-4">
                    <button
                      onClick={() => {
                        setSelectedDate('');
                        setSelectedTime('');
                      }}
                      className="text-sm px-3 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                    >
                      Datums-/Zeitfilter löschen
                    </button>
                  </div>
                </>
              ) : null}

              {statusText(galleryState) && (
                <p className={`text-sm mb-3 ${galleryState.error ? 'text-red-600' : 'text-gray-600'}`}>{statusText(galleryState)}</p>
              )}

              {photos.length === 0 ? (
                <div className="border border-dashed border-gray-300 p-8 text-center text-gray-500">
                  {currentUser
                    ? 'Keine Fotos gefunden. Prüfe Datum/Uhrzeit und lade neu.'
                    : 'Keine öffentlichen Preview-Fotos verfügbar. Bitte Bucket/Photo-Policies für Anon aktivieren oder einmal einloggen, damit ein lokaler 3er-Preview-Cache erstellt wird.'}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {galleryPreviewPhotos.map((photo) => {
                    const isFavorite = favorites.has(photo.id);
                    const isUnlocked = isPhotoUnlocked(photo);
                    const isInCart = cartItems.some((item) => item.photo_id === photo.id);
                    const imageUrl = resolvePhotoUrl(photo, resolvedPhotoUrls[photo.id]);
                    const showImage = Boolean(imageUrl && failedPhotoUrlById[photo.id] !== imageUrl);
                    const speed = photoSpeedKmh(photo);

                    return (
                      <article key={photo.id} className="border border-gray-200 bg-white overflow-hidden shadow-sm">
                        {showImage ? (
                          <div className="relative">
                            <img
                              src={imageUrl ?? undefined}
                              alt="Onride"
                              className="w-full h-48 object-cover"
                              onError={() => {
                                if (!imageUrl) return;
                                setFailedPhotoUrlById((previous) => {
                                  if (previous[photo.id] === imageUrl) return previous;
                                  return { ...previous, [photo.id]: imageUrl };
                                });
                              }}
                              onLoad={() => {
                                setFailedPhotoUrlById((previous) => {
                                  if (!previous[photo.id]) return previous;
                                  const next = { ...previous };
                                  delete next[photo.id];
                                  return next;
                                });
                              }}
                            />
                            {!isUnlocked && (
                              <>
                                <div className="pointer-events-none absolute inset-0 bg-[#0B1C2F]/20" />
                                <div
                                  className="pointer-events-none absolute inset-0 opacity-45"
                                  style={{
                                    backgroundImage:
                                      'repeating-linear-gradient(-28deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0) 28px, rgba(255,255,255,0.34) 28px, rgba(255,255,255,0.34) 56px)',
                                  }}
                                />
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                  <span className="rotate-[-18deg] text-white/80 font-semibold tracking-[0.35em] text-[11px] sm:text-xs drop-shadow-[0_2px_4px_rgba(0,0,0,0.75)]">
                                    PLOSE VORSCHAU
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-48 bg-gradient-to-br from-slate-200 to-slate-100 flex items-center justify-center text-slate-500">
                            <Camera className="h-8 w-8" />
                          </div>
                        )}
                        <div className="p-3 space-y-2">
                          <div className="flex items-center justify-end text-sm text-gray-700">
                            <span className="font-semibold">{formatPrice(photo.price_cents)}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-600">
                            <span className="inline-flex items-center gap-1">
                              <Gauge className="h-3.5 w-3.5" />
                              {speed ? `${speed.toFixed(2)} km/h` : 'Speed n/a'}
                            </span>
                            {isUnlocked ? (
                              <span className="text-green-700 font-semibold">Freigeschaltet</span>
                            ) : (
                              <span className="text-gray-500">Nicht gekauft</span>
                            )}
                          </div>
                          <div className="space-y-2">
                            <button
                              onClick={() => {
                                void toggleFavorite(photo.id);
                              }}
                              className="w-full h-11 inline-flex items-center justify-center gap-2 px-3 border border-gray-300 text-gray-700 text-sm font-medium tracking-wide hover:bg-gray-50"
                            >
                              <Heart className={`h-4 w-4 shrink-0 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                              <span className="truncate">{isFavorite ? 'Favorit gesetzt' : 'Favorisieren'}</span>
                            </button>
                            {isUnlocked ? (
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => downloadPhoto(photo)}
                                  className="h-11 inline-flex items-center justify-center gap-2 px-3 bg-[#9B8B3E] text-white text-sm font-medium tracking-wide hover:bg-[#8A7A35]"
                                >
                                  <Download className="h-4 w-4 shrink-0" />
                                  <span className="truncate">Download</span>
                                </button>
                                <button
                                  onClick={() => {
                                    void sharePhoto(photo);
                                  }}
                                  className="h-11 inline-flex items-center justify-center gap-2 px-3 border border-gray-300 text-gray-700 text-sm font-medium tracking-wide hover:bg-gray-50"
                                >
                                  <Share2 className="h-4 w-4 shrink-0" />
                                  <span className="truncate">Share</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  void addToCart(photo);
                                }}
                                disabled={isInCart || dayPassInCart}
                                className="w-full h-11 inline-flex items-center justify-center gap-2 px-3 bg-[#1E3A5F] text-white text-sm font-medium tracking-wide hover:bg-[#163251] disabled:opacity-50"
                              >
                                <ShoppingCart className="h-4 w-4 shrink-0" />
                                <span className="truncate">
                                  {isInCart
                                    ? 'Hinzugefügt'
                                    : dayPassInCart
                                      ? 'Tagesfotopass im Warenkorb'
                                      : 'In den Warenkorb'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {isTimeSearchActive && photos.length > 3 && (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    {hiddenGalleryPhotoCount > 0
                      ? `${hiddenGalleryPhotoCount} weitere Fotos ausgeblendet.`
                      : 'Alle Fotos werden angezeigt.'}
                  </p>
                  {currentUser && (
                    <button
                      onClick={() => setShowAllGalleryPhotos((previous) => !previous)}
                      className="text-sm px-3 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100"
                    >
                      {showAllGalleryPhotos ? 'Weniger anzeigen' : 'Alle Fotos anzeigen'}
                    </button>
                  )}
                </div>
              )}

              {favoritesState.error && <p className="text-sm text-red-600 mt-3">{favoritesState.error.message}</p>}
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-200 shadow-sm p-6 clip-corner">
                <h3 className="text-2xl font-bold text-gray-900 mb-4">3. Dashboard</h3>
                <div className="bg-slate-50 border border-slate-200 p-4">
                  {currentUser ? (
                    <>
                      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-200">
                        <div className="h-11 w-11 rounded-full bg-slate-200 border border-slate-300 overflow-hidden flex items-center justify-center text-xs font-semibold text-slate-700 shrink-0">
                          {accountAvatarUrl ? (
                            <img src={accountAvatarUrl} alt="Profilbild" className="h-full w-full object-cover" />
                          ) : (
                            <UserCircle2 className="h-6 w-6 text-slate-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {profileDisplayName.trim() ||
                                (typeof profile?.display_name === 'string' ? profile.display_name.trim() : '') ||
                                currentUser.email?.split('@')[0] ||
                                'Fahrer/in'}
                            </p>
                            <button
                              onClick={() => openSettingsPanel('profile')}
                              className="px-2 py-0.5 text-[11px] border border-gray-300 text-gray-700 hover:bg-gray-100 shrink-0"
                            >
                              Bearbeiten
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{currentUser.email}</p>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">Meine Werte</p>
                      <div className="space-y-2">
                        <p className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                          <Gauge className="h-5 w-5 text-[#1E3A5F]" />
                          Top-Speed: {dashboardTopSpeed ? `${dashboardTopSpeed.toFixed(2)} km/h` : 'n/a'}
                        </p>
                        <p className="text-gray-700 inline-flex items-center gap-2">
                          <ShoppingBag className="h-4 w-4 text-[#1E3A5F]" />
                          Freigeschaltet: {unlockedPhotoIds.size} Einzelbilder
                        </p>
                        <p className="text-gray-700 inline-flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-[#1E3A5F]" />
                          Käufe: {purchases.length}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="font-semibold text-gray-900">Du willst dort gesehen werden?</p>
                      <p className="text-sm text-gray-700">Dann melde dich an und kauf ein Foto.</p>
                      <button
                        onClick={() => promptLoginToUseFeature('Login to use this.')}
                        className="px-4 py-2 bg-[#9B8B3E] text-white hover:bg-[#8A7A35]"
                      >
                        Zum Login
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-[#9B8B3E] shadow-sm p-6 clip-corner">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h3 className="text-2xl font-bold text-gray-900">Tagesfotopass</h3>
                  <span className="px-3 py-1 bg-[#9B8B3E] text-white font-semibold">14,99 €</span>
                </div>

                <p className="text-sm text-gray-700 mb-3">Was du bekommst:</p>
                <div className="space-y-2 text-sm text-gray-700 mb-4">
                  <p>📸 Unbegrenzte Fotos: Alle deine Fahrten heute - ohne Einzelkauf</p>
                  <p>💾 Sofortiger Download: Hochauflösende Bilder direkt verfügbar</p>
                  <p>💰 Spare bis zu 50%: Bei 3+ Fotos schon günstiger als Einzelkauf</p>
                  <p>⭐ Keine Wartezeit: Alle Fotos automatisch freigeschaltet</p>
                </div>

                <button
                  onClick={() => {
                    if (!currentUser) {
                      promptLoginToUseFeature('Login to use this.');
                      return;
                    }
                    if (hasTodayDayPass) {
                      return;
                    }
                    if (dayPassInCart) {
                      removeDayPassFromCart();
                      return;
                    }
                    void addDayPassToCart();
                  }}
                  disabled={hasTodayDayPass}
                  className="w-full py-2 bg-[#1E3A5F] text-white font-semibold hover:bg-[#163251] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {hasTodayDayPass ? 'Wurde gekauft' : dayPassInCart ? 'Aus Warenkorb entfernen' : 'Tagesfotopass in Warenkorb'}
                </button>
              </div>
            </div>

            {currentUser && (
              <>
                <div className="bg-white border border-gray-200 shadow-sm p-6 clip-corner">
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">4. Gekaufte Bilder</h3>
                  {purchasedPhotos.length === 0 ? (
                    <p className="text-gray-600">Noch keine freigeschalteten Bilder vorhanden.</p>
                  ) : (
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {purchasedPhotos.map((photo) => {
                        const imageUrl = resolvePhotoUrl(photo, resolvedPhotoUrls[photo.id]);
                        const showImage = Boolean(imageUrl && failedPhotoUrlById[photo.id] !== imageUrl);
                        const speed = photoSpeedKmh(photo);
                        const timeLabel = formatPhotoDateTime(photo);
                        return (
                          <article key={photo.id} className="border border-gray-200 bg-white overflow-hidden">
                            {showImage ? (
                              <button
                                onClick={() => setExpandedPurchasedPhoto(photo)}
                                className="block w-full text-left"
                                aria-label="Bild groß anzeigen"
                              >
                                <img
                                  src={imageUrl ?? undefined}
                                  alt="Purchased"
                                  className="w-full h-44 object-cover cursor-zoom-in"
                                  onError={() => {
                                    if (!imageUrl) return;
                                    setFailedPhotoUrlById((previous) => {
                                      if (previous[photo.id] === imageUrl) return previous;
                                      return { ...previous, [photo.id]: imageUrl };
                                    });
                                  }}
                                  onLoad={() => {
                                    setFailedPhotoUrlById((previous) => {
                                      if (!previous[photo.id]) return previous;
                                      const next = { ...previous };
                                      delete next[photo.id];
                                      return next;
                                    });
                                  }}
                                />
                              </button>
                            ) : (
                              <div className="w-full h-44 bg-slate-100 flex items-center justify-center text-slate-500">
                                <Camera className="h-8 w-8" />
                              </div>
                            )}
                            <div className="p-3 space-y-3">
                              <div className="flex items-center justify-between text-xs text-gray-600">
                                <span className="inline-flex items-center gap-1">
                                  <Gauge className="h-3.5 w-3.5" />
                                  {speed !== null ? `${speed.toFixed(2)} km/h` : 'Speed n/a'}
                                </span>
                                <span className="text-gray-500">{timeLabel}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => downloadPhoto(photo)}
                                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-[#9B8B3E] text-white"
                                >
                                  <Download className="h-4 w-4" />
                                  Download
                                </button>
                                <button
                                  onClick={() => {
                                    void sharePhoto(photo);
                                  }}
                                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 text-gray-700"
                                >
                                  <Share2 className="h-4 w-4" />
                                  Share
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-white border border-gray-200 shadow-sm p-6 clip-corner">
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">5. Favoriten</h3>
                  {favoritePhotos.length === 0 ? (
                    <p className="text-gray-600">Noch keine Favoriten gespeichert. Markiere Bilder in der Galerie mit „Favorisieren“.</p>
                  ) : (
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {favoritePhotos.map((photo) => {
                        const isUnlocked = isPhotoUnlocked(photo);
                        const isInCart = cartItems.some((item) => item.photo_id === photo.id);
                        const imageUrl = resolvePhotoUrl(photo, resolvedPhotoUrls[photo.id]);
                        const showImage = Boolean(imageUrl && failedPhotoUrlById[photo.id] !== imageUrl);
                        return (
                          <article key={photo.id} className="border border-gray-200 bg-white overflow-hidden shadow-sm">
                            {showImage ? (
                              <div className="relative">
                                <img
                                  src={imageUrl ?? undefined}
                                  alt="Favorite"
                                  className="w-full h-44 object-cover"
                                  onError={() => {
                                    if (!imageUrl) return;
                                    setFailedPhotoUrlById((previous) => {
                                      if (previous[photo.id] === imageUrl) return previous;
                                      return { ...previous, [photo.id]: imageUrl };
                                    });
                                  }}
                                  onLoad={() => {
                                    setFailedPhotoUrlById((previous) => {
                                      if (!previous[photo.id]) return previous;
                                      const next = { ...previous };
                                      delete next[photo.id];
                                      return next;
                                    });
                                  }}
                                />
                                {!isUnlocked && (
                                  <>
                                    <div className="pointer-events-none absolute inset-0 bg-[#0B1C2F]/20" />
                                    <div
                                      className="pointer-events-none absolute inset-0 opacity-45"
                                      style={{
                                        backgroundImage:
                                          'repeating-linear-gradient(-28deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0) 28px, rgba(255,255,255,0.34) 28px, rgba(255,255,255,0.34) 56px)',
                                      }}
                                    />
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                      <span className="rotate-[-18deg] text-white/80 font-semibold tracking-[0.35em] text-[11px] sm:text-xs drop-shadow-[0_2px_4px_rgba(0,0,0,0.75)]">
                                        PLOSE VORSCHAU
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="w-full h-44 bg-slate-100 flex items-center justify-center text-slate-500">
                                <Camera className="h-8 w-8" />
                              </div>
                            )}
                            <div className="p-3 space-y-2">
                              <div className="flex items-center justify-between text-sm text-gray-700">
                                <span className="font-semibold">{formatPrice(photo.price_cents)}</span>
                                {isUnlocked ? (
                                  <span className="text-green-700 font-semibold">Freigeschaltet</span>
                                ) : (
                                  <span className="text-gray-500">Nicht gekauft</span>
                                )}
                              </div>
                              <div className="grid grid-cols-1 gap-2">
                                <button
                                  onClick={() => {
                                    void toggleFavorite(photo.id);
                                  }}
                                  className="w-full h-11 inline-flex items-center justify-center gap-2 px-3 border border-gray-300 text-gray-700 text-sm font-medium tracking-wide hover:bg-gray-50"
                                >
                                  <Heart className="h-4 w-4 shrink-0 fill-red-500 text-red-500" />
                                  <span className="truncate">Aus Favoriten entfernen</span>
                                </button>
                                {isUnlocked ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    <button
                                      onClick={() => downloadPhoto(photo)}
                                      className="h-11 inline-flex items-center justify-center gap-2 px-3 bg-[#9B8B3E] text-white text-sm font-medium tracking-wide hover:bg-[#8A7A35]"
                                    >
                                      <Download className="h-4 w-4 shrink-0" />
                                      <span className="truncate">Download</span>
                                    </button>
                                    <button
                                      onClick={() => {
                                        void sharePhoto(photo);
                                      }}
                                      className="h-11 inline-flex items-center justify-center gap-2 px-3 border border-gray-300 text-gray-700 text-sm font-medium tracking-wide hover:bg-gray-50"
                                    >
                                      <Share2 className="h-4 w-4 shrink-0" />
                                      <span className="truncate">Share</span>
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => {
                                      void addToCart(photo);
                                    }}
                                    disabled={isInCart || dayPassInCart}
                                    className="w-full h-11 inline-flex items-center justify-center gap-2 px-3 bg-[#1E3A5F] text-white text-sm font-medium tracking-wide hover:bg-[#163251] disabled:opacity-50"
                                  >
                                    <ShoppingCart className="h-4 w-4 shrink-0" />
                                    <span className="truncate">
                                      {isInCart
                                        ? 'Hinzugefügt'
                                        : dayPassInCart
                                          ? 'Tagesfotopass im Warenkorb'
                                          : 'In den Warenkorb'}
                                    </span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {favoritePhotosState.error && (
                    <p className="text-sm text-red-600 mt-3">{favoritePhotosState.error.message}</p>
                  )}
                </div>

              </>
            )}
            </>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24 self-start border border-[#9B8B3E] p-2 clip-corner">
            <div className="bg-[#1E3A5F] text-white p-6 shadow-lg clip-corner">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Warenkorb
              </h3>
              <p className="text-sm text-slate-200 mb-4">
                {selectedRideId ? `Ride: ${selectedRideName}` : 'Ride-unabhängiger Warenkorb'}
              </p>

              {cartItems.length === 0 ? (
                dayPassInCart ? (
                  <ul className="space-y-3 mb-4">
                    <li className="bg-slate-800/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">Tagesfotopass</p>
                          <p className="text-xs text-slate-300">Unbegrenzte Fotos heute</p>
                          <p className="text-xs text-slate-300">{formatPrice(DAY_PASS_PRICE_CENTS)}</p>
                        </div>
                        <button
                          onClick={removeDayPassFromCart}
                          className="text-slate-300 hover:text-white"
                          aria-label="Entfernen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  </ul>
                ) : (
                  <p className="text-slate-200 text-sm">Keine Bilder im Warenkorb.</p>
                )
              ) : (
                <ul className="space-y-3 mb-4 max-h-72 overflow-auto pr-1">
                  {cartItems.map((item) => (
                    <li key={item.id} className="bg-slate-800/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">Foto</p>
                          <p className="text-xs text-slate-300">
                            Menge {cartItemQuantity(item)}
                          </p>
                          <p className="text-xs text-slate-300">{formatPrice(cartItemUnitCents(item))}</p>
                        </div>
                        <button
                          onClick={() => {
                            void removeFromCart(item.id);
                          }}
                          className="text-slate-300 hover:text-white"
                          aria-label="Entfernen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {dayPassInCart && (
                    <li className="bg-slate-800/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">Tagesfotopass</p>
                          <p className="text-xs text-slate-300">Unbegrenzte Fotos heute</p>
                          <p className="text-xs text-slate-300">{formatPrice(DAY_PASS_PRICE_CENTS)}</p>
                        </div>
                        <button
                          onClick={removeDayPassFromCart}
                          className="text-slate-300 hover:text-white"
                          aria-label="Entfernen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  )}
                </ul>
              )}

              <div className="border-t border-slate-600 pt-4 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span>Zwischensumme</span>
                  <span className="font-semibold">{formatPrice(cartTotalCents)}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  if (!currentUser) {
                    promptLoginToUseFeature('Login to use this.');
                    return;
                  }
                  void startCheckout();
                }}
                disabled={checkoutState.state === 'loading' || (Boolean(currentUser) && cartItems.length === 0 && !dayPassInCart)}
                className="w-full py-3 bg-[#9B8B3E] hover:bg-[#8A7A35] text-white font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {checkoutState.state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                Checkout starten
              </button>

              {currentUser && (
                <div className="mt-4 border-t border-slate-600 pt-4">
                  <button
                    onClick={() => setShowSettingsDropdown((previous) => !previous)}
                    className="w-full py-2 border border-slate-400 text-slate-100 hover:bg-slate-700/50 text-sm"
                  >
                    Einstellungen
                  </button>

                  {showSettingsDropdown && (
                    <div className="mt-2 space-y-2">
                      <button
                        onClick={openGalleryAndDashboard}
                        className="w-full text-left px-3 py-2 bg-slate-800/70 text-slate-100 text-sm hover:bg-slate-700/70"
                      >
                        Galerie & Dashboard
                      </button>
                      <button
                        onClick={() => openSettingsPanel('account')}
                        className="w-full text-left px-3 py-2 bg-slate-800/70 text-slate-100 text-sm hover:bg-slate-700/70"
                      >
                        Login & Account
                      </button>
                      <button
                        onClick={() => openSettingsPanel('profile')}
                        className="w-full text-left px-3 py-2 bg-slate-800/70 text-slate-100 text-sm hover:bg-slate-700/70"
                      >
                        Profil & Sicherheit
                      </button>
                      <button
                        onClick={() => openSettingsPanel('newsletter')}
                        className="w-full text-left px-3 py-2 bg-slate-800/70 text-slate-100 text-sm hover:bg-slate-700/70"
                      >
                        Newsletter & Popup
                      </button>
                      <button
                        onClick={() => {
                          void logoutFromSettings();
                        }}
                        className="w-full text-left px-3 py-2 bg-slate-800/70 text-slate-100 text-sm hover:bg-slate-700/70"
                      >
                        Ausloggen
                      </button>
                      <button
                        onClick={() => openSettingsPanel('delete')}
                        className="w-full text-left px-3 py-2 bg-slate-800/70 text-red-200 text-sm hover:bg-slate-700/70"
                      >
                        Account löschen
                      </button>
                    </div>
                  )}
                </div>
              )}

              {statusText(cartState) && <p className="text-xs text-slate-200 mt-3">{statusText(cartState)}</p>}
              {statusText(checkoutState) && (
                <p className={`text-xs mt-1 ${checkoutState.error ? 'text-red-300' : 'text-green-200'}`}>{statusText(checkoutState)}</p>
              )}
            </div>

            <div className="bg-white border border-gray-200 shadow-sm clip-corner overflow-hidden">
              <div className="px-4 py-3 bg-[#1E3A5F] text-white font-semibold flex items-center gap-2">
                <Medal className="h-4 w-4" />
                Tagesranking
              </div>
              <ul className="divide-y divide-gray-200 max-h-64 overflow-auto bg-white">
                {effectiveLeaderboardEntries.length === 0 && (
                  <li className="p-4 text-sm text-gray-500">Noch keine Ranking-Daten für heute.</li>
                )}
                {effectiveLeaderboardEntries.map((entry, index) => {
                  const displayName = entry.display_name?.trim() || 'Fahrer/in';
                  const avatarUrl = entry.avatar_url?.trim() || '';
                  const initials =
                    displayName
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase() ?? '')
                      .join('') || 'F';

                  return (
                    <li key={entry.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-slate-200 border border-slate-300 overflow-hidden shrink-0 flex items-center justify-center text-[11px] font-semibold text-slate-700">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                          ) : (
                            initials
                          )}
                        </div>
                        <span className="font-medium text-gray-700 truncate">
                          #{index + 1} {displayName}
                        </span>
                      </div>
                      <span className="text-gray-900 font-semibold shrink-0">
                        {(entry.speed_kmh ?? 0).toFixed(2)} km/h
                      </span>
                    </li>
                  );
                })}
              </ul>
              {leaderboardState.error && <p className="text-sm text-red-600 p-3">{leaderboardState.error.message}</p>}
            </div>
          </aside>
        </div>
      </div>

      {promoPopup && (
        <div
          className={`fixed left-4 bottom-4 z-[125] w-[min(92vw,420px)] border shadow-2xl transition-all duration-300 ${
            promoPopupVisible ? 'translate-x-0 opacity-100' : '-translate-x-[120%] opacity-0'
          } ${promoPopup === 'favorite_expiry' ? 'bg-red-50 border-red-300 ring-2 ring-red-200' : 'bg-white border-gray-200'}`}
        >
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {promoPopup === 'favorite_expiry' ? (
                  <AlertTriangle className="h-5 w-5 text-red-700" />
                ) : (
                  <Bell className="h-5 w-5 text-[#1E3A5F]" />
                )}
              </div>
              <div className="min-w-0">
                {promoPopup === 'favorite_expiry' ? (
                  <>
                    <p className="text-xs font-bold uppercase tracking-wider text-red-800 mb-1">Dringend</p>
                    <p className="text-sm font-semibold text-red-900">Achtung: Nur noch 48 Stunden verfügbar.</p>
                    <p className="text-sm text-red-800 mt-1">
                      Dein Bild wird danach von unseren Servern entfernt. Sichere es dir jetzt.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-gray-900">Newsletter</p>
                    <p className="text-sm text-gray-700">
                      {newsletterPopupThanks
                        ? 'Danke fürs Abonnieren.'
                        : 'Melde dich zu unserem Newsletter an und erhalte passende Angebote und News per Mail.'}
                    </p>
                    {!newsletterPopupThanks && (
                      <button
                        onClick={() => {
                          void subscribeFromPopup();
                        }}
                        disabled={newsletterPopupSubmitting}
                        className="mt-3 px-3 py-2 bg-[#9B8B3E] text-white text-sm font-medium hover:bg-[#8A7A35] disabled:opacity-60 inline-flex items-center gap-2"
                      >
                        {newsletterPopupSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Abonnieren
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <button
              onClick={closePromoPopup}
              className="h-7 w-7 shrink-0 inline-flex items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-100"
              aria-label="Schließen"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {shareMenuPhoto && (
        <div
          className="fixed inset-0 z-[120] bg-black/45 flex items-center justify-center px-4"
          onClick={() => setShareMenuPhoto(null)}
        >
          <div
            className="w-full max-w-sm bg-white border border-gray-200 shadow-2xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-semibold text-gray-900">Teilen</h4>
              <button
                onClick={() => setShareMenuPhoto(null)}
                className="h-8 w-8 inline-flex items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-100"
                aria-label="Schließen"
              >
                ×
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Wähle eine Plattform. Auf Mobile wird zuerst die App versucht, sonst die Web-Version geöffnet.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => {
                  void shareToPlatform('instagram');
                }}
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Instagram className="h-4 w-4 text-pink-600" />
                Instagram
              </button>
              <button
                onClick={() => {
                  void shareToPlatform('x');
                }}
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Twitter className="h-4 w-4 text-gray-900" />
                X
              </button>
              <button
                onClick={() => {
                  void shareToPlatform('tiktok');
                }}
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Music2 className="h-4 w-4 text-black" />
                TikTok
              </button>
              <button
                onClick={() => {
                  void shareToPlatform('facebook');
                }}
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Facebook className="h-4 w-4 text-blue-600" />
                Facebook
              </button>
            </div>
            <button
              onClick={() => {
                void nativeShareFallback();
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-[#1E3A5F] text-white text-sm hover:bg-[#163251]"
            >
              <Share2 className="h-4 w-4" />
              System-Teilen / Link kopieren
            </button>
          </div>
        </div>
      )}

      {expandedPurchasedPhoto && (
        <div
          className="fixed inset-0 z-[130] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setExpandedPurchasedPhoto(null)}
        >
          <div
            className="relative max-w-6xl w-full max-h-[92vh] flex items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => setExpandedPurchasedPhoto(null)}
              className="absolute top-2 right-2 h-10 w-10 inline-flex items-center justify-center border border-white/40 bg-black/40 text-white hover:bg-black/60 z-10"
              aria-label="Schließen"
            >
              ×
            </button>
            <img
              src={resolvePhotoUrl(expandedPurchasedPhoto, resolvedPhotoUrls[expandedPurchasedPhoto.id]) ?? undefined}
              alt="Gekauftes Bild groß"
              className="max-w-full max-h-[92vh] object-contain bg-black"
            />
          </div>
        </div>
      )}
    </section>
  );
}
