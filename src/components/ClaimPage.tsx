import type { User } from '@supabase/supabase-js';
import { Check, Loader2, Mail } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigError } from '../lib/supabase';
import type { ApiError } from '../types/shop';

const PLOSE_PARK_ID = '3b08e092-beb5-46ec-9811-5698e86dd83a';
const PLOSE_PARK_NAME = 'Plose';
const MIN_UNLOCK_REDIRECT_DELAY_MS = 800;

type AuthMode = 'login' | 'signup';

type ClaimPhoto = {
  id: string;
  external_code: string | null;
};

type MessageState = {
  state: 'idle' | 'loading' | 'success' | 'error';
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

function toApiError(error: unknown, fallbackMessage: string): ApiError {
  if (!error || typeof error !== 'object') {
    return { code: 'unknown', message: fallbackMessage };
  }

  const err = error as { code?: unknown; message?: unknown; details?: unknown };

  const code = typeof err.code === 'string' && err.code.length > 0 ? err.code : 'unknown';
  const message =
    typeof err.message === 'string' && err.message.length > 0
      ? err.message
      : fallbackMessage;

  return {
    code,
    message,
    details: err.details,
  };
}

function sanitizeClaimCode(value: string | null): string {
  if (!value) return '';
  return value.trim();
}

function statusText(state: MessageState): string | null {
  if (state.error) return state.error.message;
  return state.message;
}

function redirectToPurchased(): void {
  window.location.assign('/?openPurchased=1#calendar');
}

export function ClaimPage() {
  const loginBoxRef = useRef<HTMLDivElement | null>(null);
  const unlockStartedRef = useRef(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authState, setAuthState] = useState<MessageState>(initialMessageState());

  const [claimPhoto, setClaimPhoto] = useState<ClaimPhoto | null>(null);
  const [claimPhotoPreviewUrl, setClaimPhotoPreviewUrl] = useState<string | null>(null);
  const [loadingClaim, setLoadingClaim] = useState(true);
  const [claimError, setClaimError] = useState<ApiError | null>(null);

  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [unlockingState, setUnlockingState] = useState<MessageState>(initialMessageState());
  const [unlockAnimationStep, setUnlockAnimationStep] = useState(0);

  const claimCode = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return sanitizeClaimCode(params.get('code'));
  }, []);

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

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setLoadingClaim(false);
      return;
    }

    if (!claimCode) {
      setClaimError({
        code: 'missing_code',
        message: 'Kein Bildcode in der URL. Bitte den QR-Link erneut öffnen.',
      });
      setLoadingClaim(false);
      return;
    }

    let active = true;

    const loadClaimPhoto = async () => {
      setLoadingClaim(true);
      setClaimError(null);

      const { data, error } = await sb.rpc('find_claim_photo', { p_code: claimCode }).single();

      if (!active) return;

      if (error || !data) {
        setClaimPhoto(null);
        setClaimPhotoPreviewUrl(null);
        setClaimError(
          toApiError(error ?? { code: 'not_found', message: 'Foto nicht gefunden.' }, 'Foto nicht gefunden.')
        );
        setLoadingClaim(false);
        return;
      }

      setClaimPhoto(data as ClaimPhoto);
      setLoadingClaim(false);
    };

    void loadClaimPhoto();

    return () => {
      active = false;
    };
  }, [claimCode]);

  useEffect(() => {
    const sb = supabase;
    if (!sb || !claimPhoto?.id) {
      setClaimPhotoPreviewUrl(null);
      return;
    }

    let active = true;

    const loadPreview = async () => {
      const { data, error } = await sb
        .from('photos')
        .select('storage_bucket, storage_path')
        .eq('id', claimPhoto.id)
        .maybeSingle();

      if (!active) return;

      if (error || !data?.storage_bucket || !data?.storage_path) {
        setClaimPhotoPreviewUrl(null);
        return;
      }

      const previewUrl = sb.storage
        .from(data.storage_bucket)
        .getPublicUrl(data.storage_path).data.publicUrl;

      setClaimPhotoPreviewUrl(previewUrl || null);
    };

    void loadPreview();

    return () => {
      active = false;
    };
  }, [claimPhoto?.id]);

  useEffect(() => {
    if (unlockingState.state !== 'loading') {
      setUnlockAnimationStep(0);
      return;
    }

    const timerId = window.setInterval(() => {
      setUnlockAnimationStep((previous) => (previous + 1) % 4);
    }, 220);

    return () => {
      window.clearInterval(timerId);
    };
  }, [unlockingState.state]);

  const unlockClaimPhoto = useCallback(async () => {
    if (!supabase || !currentUser?.id || !claimPhoto?.id) return;

    setUnlockingState({
      state: 'loading',
      message: 'Foto wird deinem Konto hinzugefügt',
      error: null,
    });

    const unlockPromise = supabase
      .from('unlocked_photos')
      .upsert(
        [
          {
            user_id: currentUser.id,
            photo_id: claimPhoto.id,
            park_id: PLOSE_PARK_ID,
          },
        ],
        {
          onConflict: 'user_id,photo_id',
          ignoreDuplicates: true,
        }
      );

    const [{ error }] = await Promise.all([
      unlockPromise,
      new Promise((resolve) => window.setTimeout(resolve, MIN_UNLOCK_REDIRECT_DELAY_MS)),
    ]);

    if (error) {
      unlockStartedRef.current = false;
      setUnlockingState({
        state: 'error',
        message: null,
        error: toApiError(error, 'Freischalten fehlgeschlagen. Bitte erneut versuchen.'),
      });
      return;
    }

    setUnlockingState({
      state: 'success',
      message: 'Foto erfolgreich freigeschaltet. Weiterleitung...',
      error: null,
    });

    redirectToPurchased();
  }, [claimPhoto?.id, currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || !claimPhoto?.id) return;
    if (unlockStartedRef.current) return;

    unlockStartedRef.current = true;
    void unlockClaimPhoto();
  }, [claimPhoto?.id, currentUser?.id, unlockClaimPhoto]);

  const handleAuth = useCallback(async () => {
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

    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    });

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

  const scrollToLogin = () => {
    setShowAuthPanel(true);
    window.setTimeout(() => {
      loginBoxRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 0);
  };

  const animatedDots = '.'.repeat(unlockAnimationStep);

  if (supabaseConfigError || !supabase) {
    return (
      <div className="min-h-screen bg-[#0b1220] text-white flex items-center justify-center px-6 py-20">
        <div className="max-w-xl w-full border border-red-500/30 bg-red-500/10 p-6 clip-corner">
          <h1 className="text-2xl font-bold mb-2">Claim derzeit nicht verfügbar</h1>
          <p className="text-sm text-red-100">{supabaseConfigError ?? 'Supabase ist nicht konfiguriert.'}</p>
          <a href="/" className="mt-4 inline-flex px-5 py-3 bg-[#9B8B3E] text-white font-semibold hover:bg-[#8A7A35]">Zur Startseite</a>
        </div>
      </div>
    );
  }

  if (!claimCode) {
    return (
      <div className="min-h-screen bg-[#0b1220] text-white flex items-center justify-center px-6 py-20">
        <div className="max-w-xl w-full border border-white/20 bg-white/5 p-6 clip-corner">
          <h1 className="text-2xl font-bold mb-2">Kein Bildcode gefunden</h1>
          <p className="text-sm text-slate-200">Bitte scanne den QR-Code erneut oder öffne den vollständigen Link.</p>
          <a href="/" className="mt-4 inline-flex px-5 py-3 bg-[#9B8B3E] text-white font-semibold hover:bg-[#8A7A35]">Zur Startseite</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1729] text-white">
      <header className="border-b border-white/10 bg-[#0b1220]/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-3">
            <img src="/assets/b0478ce9125b0eeafe32cd61185e870a_11zon.jpg" alt="Plose Logo" className="h-10 w-auto" />
            <span className="text-sm uppercase tracking-[0.28em] text-slate-300">Foto Claim</span>
          </a>
          <a href="/" className="text-sm text-slate-300 hover:text-white">Startseite</a>
        </div>
      </header>

      <main className="relative">
        <div className="absolute inset-0">
          <img src="/assets/plose-kasse-fotos.webp" alt="Plose" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#060B14]/85" />
        </div>

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="border border-white/15 bg-[#101a2d]/88 shadow-2xl p-6 sm:p-8 clip-corner">
            {loadingClaim ? (
              <div className="min-h-[280px] flex flex-col items-center justify-center text-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-[#D7C173]" />
                <p className="text-slate-200">Foto wird geladen...</p>
              </div>
            ) : claimError || !claimPhoto ? (
              <div className="min-h-[280px] flex flex-col items-center justify-center text-center gap-4">
                <h1 className="text-3xl font-bold">Foto nicht gefunden</h1>
                <p className="text-slate-300">Der Bildcode ist ungültig oder das Foto ist nicht verfügbar.</p>
                <a href="/" className="inline-flex px-5 py-3 bg-[#9B8B3E] text-white font-semibold hover:bg-[#8A7A35]">Zur Startseite</a>
              </div>
            ) : currentUser ? (
              <div className="min-h-[280px] flex flex-col items-center justify-center text-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-[#D7C173]" />
                <h1 className="text-3xl font-bold">Foto wird freigeschaltet</h1>
                <p className="text-slate-200">Foto wird deinem Konto hinzugefügt{animatedDots}</p>
                {statusText(unlockingState) && unlockingState.state === 'error' ? (
                  <button
                    onClick={() => {
                      unlockStartedRef.current = false;
                      void unlockClaimPhoto();
                    }}
                    className="px-5 py-3 bg-[#9B8B3E] text-white font-semibold hover:bg-[#8A7A35]"
                  >
                    Erneut versuchen
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <p className="inline-flex px-3 py-1 bg-[#D7C173]/20 border border-[#D7C173]/30 text-[#E8D893] text-xs font-semibold tracking-[0.16em] uppercase">Foto Claim</p>
                  <h1 className="mt-4 text-3xl sm:text-4xl font-bold">Dein Foto zum Download</h1>
                  <p className="mt-3 text-slate-300">Melde dich an und verknüpfe dieses Bild direkt mit deinem Konto.</p>
                </div>

                {claimPhotoPreviewUrl ? (
                  <div className="relative rounded-sm overflow-hidden border border-white/15 mb-6 h-48 sm:h-56">
                    <img src={claimPhotoPreviewUrl} alt="Claim Preview" className="h-full w-full object-cover scale-105 blur-[2px]" />
                    <div className="absolute inset-0 bg-black/45" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="px-3 py-1 bg-black/55 border border-white/25 text-white text-xs font-semibold tracking-[0.2em]">VORSCHAU</span>
                    </div>
                  </div>
                ) : null}

                <div className="bg-[#0A1222]/75 border border-white/10 p-4 mb-6 space-y-3 text-sm text-slate-100">
                  <p className="inline-flex gap-2"><Check className="h-4 w-4 mt-0.5 text-emerald-400" />Sieh deine Fahrt im Speed-Ranking und vergleiche dich mit anderen</p>
                  <p className="inline-flex gap-2"><Check className="h-4 w-4 mt-0.5 text-emerald-400" />HD-Download dauerhaft in deiner persönlichen Galerie</p>
                  <p className="inline-flex gap-2"><Check className="h-4 w-4 mt-0.5 text-emerald-400" />Teile dein Erlebnis direkt mit Freunden</p>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-6">
                  <div className="text-center">
                    <div className="h-2 bg-[#9B8B3E]" />
                    <p className="mt-2 text-xs text-slate-300">Foto gefunden</p>
                  </div>
                  <div className="text-center">
                    <div className="h-2 bg-[#D7C173]" />
                    <p className="mt-2 text-xs text-slate-300">Account</p>
                  </div>
                  <div className="text-center">
                    <div className="h-2 bg-white/25" />
                    <p className="mt-2 text-xs text-slate-300">Download</p>
                  </div>
                </div>

                <button
                  onClick={scrollToLogin}
                  className="w-full h-12 inline-flex items-center justify-center gap-2 bg-[#9B8B3E] text-white font-semibold hover:bg-[#8A7A35]"
                >
                  Kostenlos Freischalten
                </button>

                {showAuthPanel ? (
                  <div ref={loginBoxRef} className="mt-5 border border-white/15 bg-[#0A1222]/80 p-5 clip-corner">
                    <h2 className="text-xl font-bold">Login & Account</h2>
                    <p className="text-sm text-slate-300 mt-1">Login oder Account erstellen.</p>
                    <div className="mt-4 space-y-3">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <input
                          value={authEmail}
                          onChange={(event) => setAuthEmail(event.target.value)}
                          type="email"
                          placeholder="E-Mail"
                          className="w-full border border-white/20 bg-black/25 px-3 py-2 text-white placeholder:text-slate-400"
                        />
                        <input
                          value={authPassword}
                          onChange={(event) => setAuthPassword(event.target.value)}
                          type="password"
                          placeholder="Passwort"
                          className="w-full border border-white/20 bg-black/25 px-3 py-2 text-white placeholder:text-slate-400"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setAuthMode((previous) => (previous === 'login' ? 'signup' : 'login'))}
                          className="px-4 py-2 border border-white/20 text-slate-200 hover:bg-white/10"
                        >
                          {authMode === 'login' ? 'Noch kein Konto? Account erstellen' : 'Schon registriert? Zum Login'}
                        </button>
                        <button
                          onClick={() => {
                            void handleAuth();
                          }}
                          disabled={authState.state === 'loading'}
                          className="px-5 py-2 bg-[#9B8B3E] text-white hover:bg-[#8A7A35] disabled:opacity-60 inline-flex items-center gap-2"
                        >
                          {authState.state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                          {authMode === 'login' ? 'Weiter' : 'Account erstellen'}
                        </button>
                      </div>
                      {statusText(authState) ? (
                        <p className={`text-sm ${authState.error ? 'text-red-300' : 'text-emerald-300'}`}>{statusText(authState)}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
