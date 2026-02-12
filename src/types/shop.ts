export type UiState = 'idle' | 'loading' | 'success' | 'error';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface UserProfile {
  id: string;
  email: string | null;
  park_id?: string | null;
  park_name?: string | null;
  vorname?: string | null;
  nachname?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  popup_enabled?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Ride {
  id: string;
  name?: string | null;
  park_id?: string | null;
  ride_date?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface Photo {
  id: string;
  ride_id?: string | null;
  park_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  speed_kmh?: number | null;
  price_cents?: number | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface CartItem {
  id: string;
  user_id: string;
  photo_id: string;
  park_id?: string | null;
  quantity?: number | null;
  created_at?: string | null;
  photo?: Photo | null;
}

export interface Purchase {
  id: string;
  user_id: string;
  park_id?: string | null;
  status?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface UnlockedPhoto {
  id: string;
  user_id: string;
  park_id?: string | null;
  photo_id?: string | null;
  unlocked_at?: string | null;
  unlock_date?: string | null;
  ride_date?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface LeaderboardEntry {
  id: string;
  user_id?: string | null;
  park_id?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  speed_kmh?: number | null;
  rank_position?: number | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface NewsletterSubscription {
  id?: string;
  user_id: string;
  park_id?: string | null;
  email: string;
  subscribed: boolean;
  popup_enabled?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CheckoutRequest {
  success_url: string;
  cancel_url: string;
  mode?: 'payment' | 'subscription';
  park_id?: string;
  parkId?: string;
  ride_id?: string;
  successUrl?: string;
  cancelUrl?: string;
  photo_ids?: string[];
  cart_item_ids?: string[];
  items?: Array<{
    photoId?: string;
    photo_id?: string;
    price?: number;
    price_cents?: number;
    quantity: number;
    type?: string;
    name?: string;
    description?: string;
    parkId?: string;
    park_id?: string;
  }>;
  price_id?: string;
  priceId?: string;
  quantity?: number;
}

export interface CheckoutResponse {
  checkout_url?: string;
  url?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface DeleteAccountRequest {
  email: string;
  otp: string;
  reason?: string;
}

export interface DeleteAccountResponse {
  success: boolean;
  message?: string;
}
