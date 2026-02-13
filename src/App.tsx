import { Camera, Calendar, ShoppingBag, ChevronDown, Medal, Gauge, Clock3, QrCode, Download, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PhotoShopSection } from './components/PhotoShopSection';
import { createEphemeralSupabaseClient, supabase } from './lib/supabase';
import type { LeaderboardEntry } from './types/shop';

const PLOSE_PARK_ID = 'ef4ceae9-f2e2-4f8f-b681-2927c90ceb42';
const PLOSE_TIMEZONE = 'Europe/Rome';
const GUEST_LEADERBOARD_CACHE_KEY = 'plose_guest_leaderboard_v1';
const PLOSE_AVATAR_BUCKET =
  (import.meta.env.VITE_PLOSE_AVATAR_BUCKET as string | undefined)?.trim() || 'avatars';
type UiLanguage = 'de' | 'en' | 'it';

type TextReplacement = [RegExp, string];

const ORIGINAL_TEXT_BY_NODE = new WeakMap<Text, string>();
const ORIGINAL_ATTR_BY_ELEMENT = new WeakMap<Element, Record<string, string>>();

const EN_REPLACEMENTS: TextReplacement[] = [
  [/\bPlosebob Erinnerungen\b/g, 'Plosebob Memories'],
  [/Finde dein persönliches Erinnerungsfoto vom Plosebob-Erlebnis/g, 'Find your personal souvenir photo from the Plosebob experience'],
  [/Jetzt Foto ansehen/g, 'View photo now'],
  [/\bSOMMER\b/g, 'SUMMER'],
  [/\bWINTER\b/g, 'WINTER'],
  [/ÖFFNUNGSZEITEN & PREISE/g, 'OPENING HOURS & PRICES'],
  [/\bHOTELS\b/g, 'HOTELS'],
  [/\bJOBS\b/g, 'JOBS'],
  [/\bFotos kaufen\b/g, 'Buy photos'],
  [/\bSo einfach geht's\b/g, "It's that easy"],
  [/In nur drei Schritten zu deinem persönlichen Erinnerungsfoto\. Schnell, sicher und direkt auf dein Gerät\./g, 'Your personal souvenir photo in just three steps. Fast, secure, and directly on your device.'],
  [/\b1\. Foto finden\b/g, '1. Find your photo'],
  [/\b2\. Bild auswählen\b/g, '2. Choose your photo'],
  [/\b3\. Kaufen und teilen\b/g, '3. Buy and share'],
  [/Wähle Datum und Uhrzeit deiner Fahrt und finde deine Aufnahme in Sekunden\./g, 'Select your ride date and time and find your shot in seconds.'],
  [/Sieh dir deine Vorschau mit Wasserzeichen an und speichere Favoriten für später\./g, 'View your watermarked preview and save favorites for later.'],
  [/Nach dem Checkout ist dein Foto sofort freigeschaltet - bereit für Download und Social Share\./g, 'After checkout, your photo is unlocked instantly and ready for download and social sharing.'],
  [/\bZeitfenster-Suche\b/g, 'Time-window search'],
  [/\bRide-Scan kompatibel\b/g, 'Ride-scan compatible'],
  [/\bHohe Bildqualität\b/g, 'High image quality'],
  [/\bDirekt in den Warenkorb\b/g, 'Directly to cart'],
  [/\bSofortiger Download\b/g, 'Instant download'],
  [/\bTeilen mit 1 Klick\b/g, 'Share in 1 click'],
  [/\bDashboard\b/g, 'Dashboard'],
  [/\bTagesranking\b/g, 'Daily ranking'],
  [/Reset um 07:00 Uhr in:/g, 'Resets at 07:00 in:'],
  [/Willst du auch hier auftauchen\?/g, 'Want to appear here too?'],
  [/\bKaufe jetzt dein Bild\b/g, 'Buy your photo now'],
  [/Heute sind noch keine Fahrer\/innen im Ranking\./g, 'No riders in today\'s ranking yet.'],
  [/Noch kein Eintrag heute/g, 'No entry yet today'],
  [/\bPlatz frei\b/g, 'Slot available'],
  [/Heute im Plosebob Ranking/g, 'Today in Plosebob ranking'],
  [/\bBildkalender Shop\b/g, 'Photo Calendar Shop'],
  [/Voller Shop-Flow direkt auf der Seite: Login, Galerie, Favoriten, Warenkorb, Checkout, Käufe,\s*Ranking, Profil, Newsletter und sicherer Account-Delete mit E-Mail-Bestätigung\./g, 'Full shop flow directly on the site: login, gallery, favorites, cart, checkout, purchases, ranking, profile, newsletter, and secure account deletion with email confirmation.'],
  [/\bLogin & Account\b/g, 'Login & Account'],
  [/\bLogin oder Account erstellen\./g, 'Login or create an account.'],
  [/\bNoch kein Konto\? Account erstellen\b/g, 'No account yet? Create account'],
  [/\bSchon registriert\? Zum Login\b/g, 'Already registered? Go to login'],
  [/\bAccount erstellen\b/g, 'Create account'],
  [/\bWeiter\b/g, 'Continue'],
  [/\bGalerie\b/g, 'Gallery'],
  [/Datums-\/zeitbasiert, inkl\. Kaufstatus und Favoriten\./g, 'Date/time based, including purchase status and favorites.'],
  [/\bFinde mein Foto\b/g, 'Find my photo'],
  [/\bKalender schließen\b/g, 'Close calendar'],
  [/\bAktualisieren\b/g, 'Refresh'],
  [/\bDatum\b/g, 'Date'],
  [/Zeit \(Pflicht\)/g, 'Time (required)'],
  [/Zeigt automatisch Fotos aus den letzten 7 Minuten bis zur gewählten Uhrzeit\./g, 'Automatically shows photos from the last 7 minutes up to the selected time.'],
  [/Datums-\/Zeitfilter löschen/g, 'Clear date/time filter'],
  [/Keine Fotos gefunden\. Prüfe Datum\/Uhrzeit und lade neu\./g, 'No photos found. Check date/time and refresh.'],
  [/Keine öffentlichen Preview-Fotos verfügbar\./g, 'No public preview photos available.'],
  [/\bFavorisieren\b/g, 'Favorite'],
  [/\bFavorit gesetzt\b/g, 'Favorited'],
  [/\bNicht gekauft\b/g, 'Not purchased'],
  [/\bFreigeschaltet\b/g, 'Unlocked'],
  [/\bDownload\b/g, 'Download'],
  [/\bWarenkorb\b/g, 'Cart'],
  [/Keine Bilder im Warenkorb\./g, 'No photos in cart.'],
  [/Zwischensumme/g, 'Subtotal'],
  [/Checkout starten/g, 'Start checkout'],
  [/Einstellungen/g, 'Settings'],
  [/Galerie & Dashboard/g, 'Gallery & Dashboard'],
  [/Profil & Sicherheit/g, 'Profile & Security'],
  [/Newsletter & Popup/g, 'Newsletter & Popup'],
  [/Ausloggen/g, 'Log out'],
  [/Account löschen/g, 'Delete account'],
  [/\bGekaufte Bilder\b/g, 'Purchased photos'],
  [/Noch keine freigeschalteten Bilder vorhanden\./g, 'No unlocked photos yet.'],
  [/\bFavoriten\b/g, 'Favorites'],
  [/Noch keine Favoriten gespeichert\./g, 'No favorites saved yet.'],
  [/\bTagesfotopass\b/g, 'Day photo pass'],
  [/Was du bekommst:/g, 'What you get:'],
  [/Unbegrenzte Fotos/g, 'Unlimited photos'],
  [/Sofortiger Download/g, 'Instant download'],
  [/Spare bis zu 50%/g, 'Save up to 50%'],
  [/Keine Wartezeit/g, 'No waiting time'],
];

const IT_REPLACEMENTS: TextReplacement[] = [
  [/\bPlosebob Erinnerungen\b/g, 'Ricordi Plosebob'],
  [/Finde dein persönliches Erinnerungsfoto vom Plosebob-Erlebnis/g, 'Trova la tua foto ricordo personale dell\'esperienza Plosebob'],
  [/Jetzt Foto ansehen/g, 'Guarda ora la foto'],
  [/\bSOMMER\b/g, 'ESTATE'],
  [/\bWINTER\b/g, 'INVERNO'],
  [/ÖFFNUNGSZEITEN & PREISE/g, 'ORARI & PREZZI'],
  [/\bHOTELS\b/g, 'HOTEL'],
  [/\bJOBS\b/g, 'LAVORO'],
  [/\bFotos kaufen\b/g, 'Acquista foto'],
  [/\bSo einfach geht's\b/g, 'È così semplice'],
  [/In nur drei Schritten zu deinem persönlichen Erinnerungsfoto\. Schnell, sicher und direkt auf dein Gerät\./g, 'La tua foto ricordo personale in soli tre passaggi. Veloce, sicuro e direttamente sul tuo dispositivo.'],
  [/\b1\. Foto finden\b/g, '1. Trova la tua foto'],
  [/\b2\. Bild auswählen\b/g, '2. Seleziona la foto'],
  [/\b3\. Kaufen und teilen\b/g, '3. Acquista e condividi'],
  [/Wähle Datum und Uhrzeit deiner Fahrt und finde deine Aufnahme in Sekunden\./g, 'Seleziona data e ora della corsa e trova la tua foto in pochi secondi.'],
  [/Sieh dir deine Vorschau mit Wasserzeichen an und speichere Favoriten für später\./g, 'Guarda l\'anteprima con filigrana e salva i preferiti per dopo.'],
  [/Nach dem Checkout ist dein Foto sofort freigeschaltet - bereit für Download und Social Share\./g, 'Dopo il checkout la tua foto è subito sbloccata, pronta per download e condivisione social.'],
  [/\bZeitfenster-Suche\b/g, 'Ricerca per fascia oraria'],
  [/\bRide-Scan kompatibel\b/g, 'Compatibile con scansione ride'],
  [/\bHohe Bildqualität\b/g, 'Alta qualità immagine'],
  [/\bDirekt in den Warenkorb\b/g, 'Direttamente nel carrello'],
  [/\bSofortiger Download\b/g, 'Download immediato'],
  [/\bTeilen mit 1 Klick\b/g, 'Condividi con 1 clic'],
  [/\bDashboard\b/g, 'Dashboard'],
  [/\bTagesranking\b/g, 'Classifica giornaliera'],
  [/Reset um 07:00 Uhr in:/g, 'Reset alle 07:00 tra:'],
  [/Willst du auch hier auftauchen\?/g, 'Vuoi apparire anche qui?'],
  [/\bKaufe jetzt dein Bild\b/g, 'Acquista ora la tua foto'],
  [/Heute sind noch keine Fahrer\/innen im Ranking\./g, 'Ancora nessun partecipante nella classifica di oggi.'],
  [/Noch kein Eintrag heute/g, 'Nessuna voce oggi'],
  [/\bPlatz frei\b/g, 'Posto libero'],
  [/Heute im Plosebob Ranking/g, 'Oggi nella classifica Plosebob'],
  [/\bBildkalender Shop\b/g, 'Shop Calendario Foto'],
  [/Voller Shop-Flow direkt auf der Seite: Login, Galerie, Favoriten, Warenkorb, Checkout, Käufe,\s*Ranking, Profil, Newsletter und sicherer Account-Delete mit E-Mail-Bestätigung\./g, 'Flusso shop completo direttamente sul sito: login, galleria, preferiti, carrello, checkout, acquisti, classifica, profilo, newsletter ed eliminazione sicura account con conferma email.'],
  [/\bLogin & Account\b/g, 'Login e Account'],
  [/\bLogin oder Account erstellen\./g, 'Accedi o crea un account.'],
  [/\bNoch kein Konto\? Account erstellen\b/g, 'Nessun account? Crea account'],
  [/\bSchon registriert\? Zum Login\b/g, 'Già registrato? Vai al login'],
  [/\bAccount erstellen\b/g, 'Crea account'],
  [/\bWeiter\b/g, 'Continua'],
  [/\bGalerie\b/g, 'Galleria'],
  [/Datums-\/zeitbasiert, inkl\. Kaufstatus und Favoriten\./g, 'Basata su data/ora, incl. stato acquisto e preferiti.'],
  [/\bFinde mein Foto\b/g, 'Trova la mia foto'],
  [/\bKalender schließen\b/g, 'Chiudi calendario'],
  [/\bAktualisieren\b/g, 'Aggiorna'],
  [/\bDatum\b/g, 'Data'],
  [/Zeit \(Pflicht\)/g, 'Ora (obbligatoria)'],
  [/Zeigt automatisch Fotos aus den letzten 7 Minuten bis zur gewählten Uhrzeit\./g, 'Mostra automaticamente le foto degli ultimi 7 minuti fino all\'orario selezionato.'],
  [/Datums-\/Zeitfilter löschen/g, 'Cancella filtro data/ora'],
  [/Keine Fotos gefunden\. Prüfe Datum\/Uhrzeit und lade neu\./g, 'Nessuna foto trovata. Controlla data/ora e aggiorna.'],
  [/Keine öffentlichen Preview-Fotos verfügbar\./g, 'Nessuna anteprima pubblica disponibile.'],
  [/\bFavorisieren\b/g, 'Aggiungi ai preferiti'],
  [/\bFavorit gesetzt\b/g, 'Nei preferiti'],
  [/\bNicht gekauft\b/g, 'Non acquistata'],
  [/\bFreigeschaltet\b/g, 'Sbloccata'],
  [/\bDownload\b/g, 'Download'],
  [/\bWarenkorb\b/g, 'Carrello'],
  [/Keine Bilder im Warenkorb\./g, 'Nessuna foto nel carrello.'],
  [/Zwischensumme/g, 'Subtotale'],
  [/Checkout starten/g, 'Avvia checkout'],
  [/Einstellungen/g, 'Impostazioni'],
  [/Galerie & Dashboard/g, 'Galleria e Dashboard'],
  [/Profil & Sicherheit/g, 'Profilo e Sicurezza'],
  [/Newsletter & Popup/g, 'Newsletter e Popup'],
  [/Ausloggen/g, 'Esci'],
  [/Account löschen/g, 'Elimina account'],
  [/\bGekaufte Bilder\b/g, 'Foto acquistate'],
  [/Noch keine freigeschalteten Bilder vorhanden\./g, 'Nessuna foto sbloccata al momento.'],
  [/\bFavoriten\b/g, 'Preferiti'],
  [/Noch keine Favoriten gespeichert\./g, 'Nessun preferito salvato.'],
  [/\bTagesfotopass\b/g, 'Pass foto giornaliero'],
  [/Was du bekommst:/g, 'Cosa ottieni:'],
  [/Unbegrenzte Fotos/g, 'Foto illimitate'],
  [/Spare bis zu 50%/g, 'Risparmia fino al 50%'],
  [/Keine Wartezeit/g, 'Nessuna attesa'],
];

function translateText(text: string, language: UiLanguage): string {
  if (language === 'de') return text;
  const replacements = language === 'it' ? IT_REPLACEMENTS : EN_REPLACEMENTS;
  let translated = text;
  for (const [pattern, replacement] of replacements) {
    translated = translated.replace(pattern, replacement);
  }
  return translated;
}

function applyLanguageToDom(language: UiLanguage): void {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const parentTag = textNode.parentElement?.tagName;
    if (parentTag !== 'SCRIPT' && parentTag !== 'STYLE') {
      const currentValue = textNode.nodeValue ?? '';
      const hasBaseline = ORIGINAL_TEXT_BY_NODE.has(textNode);
      if (!hasBaseline) {
        ORIGINAL_TEXT_BY_NODE.set(textNode, currentValue);
      } else {
        const baseline = ORIGINAL_TEXT_BY_NODE.get(textNode) ?? '';
        const expectedTranslated = translateText(baseline, language);
        // If React updated this text node after our last translation pass,
        // refresh baseline so live values (prices/countdowns) are not reverted.
        if (currentValue !== expectedTranslated) {
          ORIGINAL_TEXT_BY_NODE.set(textNode, currentValue);
        }
      }
      const baseline = ORIGINAL_TEXT_BY_NODE.get(textNode) ?? currentValue;
      const nextValue = translateText(baseline, language);
      if (textNode.nodeValue !== nextValue) {
        textNode.nodeValue = nextValue;
      }
    }
    current = walker.nextNode();
  }

  const elements = root.querySelectorAll('[placeholder], [title], [aria-label], [alt]');
  elements.forEach((element) => {
    const attrCache = ORIGINAL_ATTR_BY_ELEMENT.get(element) ?? {};
    (['placeholder', 'title', 'aria-label', 'alt'] as const).forEach((attr) => {
      const existing = element.getAttribute(attr);
      if (existing === null) return;
      if (!Object.prototype.hasOwnProperty.call(attrCache, attr)) {
        attrCache[attr] = existing;
      }
      const translated = translateText(attrCache[attr], language);
      if (existing !== translated) {
        element.setAttribute(attr, translated);
      }
    });
    ORIGINAL_ATTR_BY_ELEMENT.set(element, attrCache);
  });
}

function normalizeToAbsoluteUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;

  const supabaseUrl =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
    (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined) ??
    '';

  if (!supabaseUrl) return value;
  if (value.startsWith('/')) return `${supabaseUrl}${value}`;
  if (value.startsWith('storage/v1/')) return `${supabaseUrl}/${value}`;
  return value;
}

function resolveAvatarUrl(value: string | null | undefined): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';

  const normalized = normalizeToAbsoluteUrl(raw);
  if (normalized && (normalized.startsWith('http://') || normalized.startsWith('https://'))) {
    return normalized;
  }

  if (!supabase) return normalized ?? raw;

  const path = raw.replace(/^\/+/, '');
  if (!path || path.includes('://') || path.startsWith('storage/v1/')) {
    return normalized ?? raw;
  }

  let bucket = PLOSE_AVATAR_BUCKET;
  let objectPath = path;

  const urlMatch = raw.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/?#]+)\/(.+?)(?:\?|$)/i);
  if (urlMatch) {
    bucket = decodeURIComponent(urlMatch[1] ?? '').trim() || bucket;
    objectPath = decodeURIComponent(urlMatch[2] ?? '').trim() || objectPath;
  } else {
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] !== PLOSE_AVATAR_BUCKET) {
      bucket = parts[0];
      objectPath = parts.slice(1).join('/');
    } else if (parts.length >= 2 && parts[0] === PLOSE_AVATAR_BUCKET) {
      objectPath = parts.slice(1).join('/');
    }
  }

  if (!objectPath) return normalized ?? raw;

  const publicUrl = supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
  return normalizeToAbsoluteUrl(publicUrl) ?? publicUrl ?? normalized ?? raw;
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

function formatCountdown(diffMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function countdownToResetAt7(timeZone: string, nowMs: number): string {
  const zonedNow = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone }));
  const nextReset = new Date(zonedNow);
  nextReset.setHours(7, 0, 0, 0);
  if (zonedNow >= nextReset) {
    nextReset.setDate(nextReset.getDate() + 1);
  }
  return formatCountdown(nextReset.getTime() - zonedNow.getTime());
}

function App() {
  const RANKING_SLOTS = 6;
  const [publicRanking, setPublicRanking] = useState<LeaderboardEntry[]>([]);
  const [rankingLoadError, setRankingLoadError] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [liveBadgeToggle, setLiveBadgeToggle] = useState(false);
  const [language, setLanguage] = useState<UiLanguage>(() => {
    if (typeof window === 'undefined') return 'de';
    const stored = window.localStorage.getItem('plose_ui_language');
    return stored === 'en' || stored === 'it' || stored === 'de' ? stored : 'de';
  });

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-fade-in-up');
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll('.observe-scroll').forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;

    let active = true;

    const readCachedRanking = (): LeaderboardEntry[] => {
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
          .slice(0, 10);
      } catch {
        return [];
      }
    };

    const writeCachedRanking = (rows: LeaderboardEntry[]) => {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(GUEST_LEADERBOARD_CACHE_KEY, JSON.stringify(rows.slice(0, 20)));
      } catch {
        // ignore storage write failures
      }
    };

    const initialCachedRows = readCachedRanking();
    if (initialCachedRows.length > 0) {
      setPublicRanking(initialCachedRows);
      setRankingLoadError(null);
    }

    const loadPublicRanking = async () => {
      const parkToday = dateKeyInTimeZone(new Date(), PLOSE_TIMEZONE);

      const fetchRankingRows = async (client: typeof sb) =>
        client
          .from('leaderboard_entries')
          .select('id,user_id,park_id,ride_date,speed_kmh,display_name,avatar_url,created_at')
          .eq('park_id', PLOSE_PARK_ID)
          .order('created_at', { ascending: false })
          .limit(200);

      let { data, error } = await fetchRankingRows(sb);

      if (error) {
        const guestClient = createEphemeralSupabaseClient();
        if (guestClient) {
          const { error: anonError } = await guestClient.auth.signInAnonymously();
          if (!anonError) {
            const guestResult = await fetchRankingRows(guestClient as typeof sb);
            data = guestResult.data;
            error = guestResult.error;
          }
        }
      }

      if (!active) return;
      if (error) {
        const cachedRows = readCachedRanking();
        if (cachedRows.length > 0) {
          setPublicRanking(cachedRows);
          setRankingLoadError(null);
          return;
        }
        setRankingLoadError('Tagesranking konnte gerade nicht geladen werden.');
        return;
      }

      const baseRows = ((data ?? []) as LeaderboardEntry[])
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
        .slice(0, 10);

      type UserRow = {
        id?: string | null;
        email?: string | null;
        display_name?: string | null;
        vorname?: string | null;
        nachname?: string | null;
        avatar_url?: string | null;
      };

      const userIds = [...new Set(
        baseRows
          .map((entry) => (typeof entry.user_id === 'string' ? entry.user_id : null))
          .filter((id): id is string => Boolean(id))
      )];

      const usersById = new Map<string, UserRow>();
      if (userIds.length > 0) {
        const { data: userRows } = await sb
          .from('users')
          .select('*')
          .in('id', userIds);

        for (const row of (userRows ?? []) as UserRow[]) {
          const id = typeof row.id === 'string' ? row.id : null;
          if (!id) continue;
          usersById.set(id, row);
        }
      }

      const rows = baseRows.map((entry, index) => {
        const user = typeof entry.user_id === 'string' ? usersById.get(entry.user_id) : null;
        const first = typeof user?.vorname === 'string' ? user.vorname.trim() : '';
        const last = typeof user?.nachname === 'string' ? user.nachname.trim() : '';
        const fullName = `${first} ${last}`.trim();
        const userDisplay = typeof user?.display_name === 'string' ? user.display_name.trim() : '';
        const rawEntryDisplay = typeof entry.display_name === 'string' ? entry.display_name.trim() : '';
        const entryDisplay =
          /^fahrer\/in(?:\s+\d+)?$/i.test(rawEntryDisplay) ? '' : rawEntryDisplay;
        const displayName =
          entryDisplay || userDisplay || fullName || `Fahrer/in ${index + 1}`;

        const entryAvatar = typeof entry.avatar_url === 'string' ? entry.avatar_url.trim() : '';
        const userAvatar = typeof user?.avatar_url === 'string' ? user.avatar_url.trim() : '';

        return {
          ...entry,
          display_name: displayName,
          avatar_url: userAvatar || entryAvatar || null,
          rank_position: index + 1,
        } as LeaderboardEntry;
      });

      if (rows.length === 0) {
        const cachedRows = readCachedRanking();
        if (cachedRows.length > 0) {
          setRankingLoadError(null);
          setPublicRanking(cachedRows);
          return;
        }
      }

      setRankingLoadError(null);
      setPublicRanking(rows);
      if (rows.length > 0) {
        writeCachedRanking(rows);
      }
    };

    void loadPublicRanking();
    const timerId = window.setInterval(() => {
      void loadPublicRanking();
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick(Date.now());
      setLiveBadgeToggle((previous) => !previous);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const resetCountdown = countdownToResetAt7(PLOSE_TIMEZONE, clockTick);
  const liveBadgeLabel = liveBadgeToggle ? 'Aktuell' : 'Live';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('plose_ui_language', language);

    const run = () => applyLanguageToDom(language);
    run();
    const mutationObserver = new MutationObserver(() => run());
    mutationObserver.observe(document.getElementById('root') ?? document.body, {
      childList: true,
      subtree: true,
    });
    return () => mutationObserver.disconnect();
  }, [language]);

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <img src="/assets/b0478ce9125b0eeafe32cd61185e870a_11zon.jpg" alt="Plose Logo" className="h-20 w-auto" />
            </div>

            <div className="flex items-center gap-4">
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as UiLanguage)}
                className="h-10 text-sm font-medium border border-gray-300 bg-white px-3 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#9B8B3E]/40"
                aria-label="Sprache auswählen"
              >
                <option value="de">DE</option>
                <option value="en">EN</option>
                <option value="it">IT</option>
              </select>

            <nav className="hidden md:flex items-center space-x-6">
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">SOMMER</a>
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">WINTER</a>
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">ÖFFNUNGSZEITEN & PREISE</a>
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">HOTELS</a>
              <a href="#" className="text-gray-700 hover:text-[#9B8B3E] transition font-medium">JOBS</a>
              <button className="flex items-center space-x-2 bg-[#9B8B3E] text-white px-4 py-2 hover:bg-[#8A7A35] transition">
                <Camera className="h-4 w-4" />
                <span className="text-sm font-medium">Fotos kaufen</span>
              </button>
            </nav>
            </div>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="/assets/plose-kasse-fotos.webp"
            alt="Plose Background"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black opacity-40"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 relative z-10">
          <div className="flex flex-col md:flex-row items-center justify-center gap-8">
            <div className="text-center md:text-left">
              <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">Plosebob Erinnerungen</h1>
              <p className="text-xl md:text-2xl text-white mb-8 max-w-3xl">Finde dein persönliches Erinnerungsfoto vom Plosebob-Erlebnis</p>
              <a href="#calendar" className="inline-flex items-center space-x-2 bg-[#9B8B3E] text-white px-8 py-4 text-lg font-medium hover:bg-[#8A7A35] transition shadow-lg hover:shadow-xl">
                <span>Jetzt Foto ansehen</span>
                <Camera className="h-5 w-5" />
              </a>
            </div>
            <div className="border-2 border-white p-2">
              <img src="/assets/Plosebob_Plosebob_Argento-Artistry.png.webp" alt="Plosebob" className="w-48 h-48 md:w-64 md:h-64 object-contain border-2 border-white p-2" />
            </div>
          </div>

          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce-smooth">
            <div className="flex flex-col items-center">
              <ChevronDown className="h-8 w-8 text-white" strokeWidth={3} />
              <ChevronDown className="h-8 w-8 text-white -mt-4" strokeWidth={3} />
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <svg className="absolute bottom-0 w-full h-full" viewBox="0 0 1440 800" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice">
            <path d="M0,400 L200,350 L400,380 L600,280 L800,320 L1000,250 L1200,300 L1440,280 L1440,800 L0,800 Z" fill="#D1D5DB" opacity="0.5"/>
            <path d="M0,500 L150,480 L300,450 L500,420 L700,460 L900,400 L1100,440 L1300,420 L1440,450 L1440,800 L0,800 Z" fill="#D1D5DB" opacity="0.3"/>
          </svg>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16 observe-scroll opacity-0">
            <h2 className="text-4xl font-bold text-gray-800 mb-4">So einfach geht's</h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              In nur drei Schritten zu deinem persönlichen Erinnerungsfoto. Schnell, sicher und direkt auf dein Gerät.
            </p>
          </div>

          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-5 lg:max-w-[430px]">
              <div className="observe-scroll opacity-0 group p-5 sm:p-6 min-h-[236px] sm:min-h-[248px] bg-gradient-to-br from-white to-[#F7F5ED] border border-[#E5DEC2] shadow-sm hover:shadow-xl transition-all duration-500 hover:-translate-y-1 flex flex-col">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-[#9B8B3E] text-white rounded-full shadow-md group-hover:scale-105 transition-transform duration-300">
                    <Calendar className="h-6 w-6" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">1. Foto finden</h3>
                <p className="text-sm text-gray-600 mb-3">Wähle Datum und Uhrzeit deiner Fahrt und finde deine Aufnahme in Sekunden.</p>
                <div className="grid sm:grid-cols-2 gap-2 text-sm text-gray-700 mt-auto">
                  <p className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-[#9B8B3E]" />Zeitfenster-Suche</p>
                  <p className="inline-flex items-center gap-2"><QrCode className="h-4 w-4 text-[#9B8B3E]" />Ride-Scan kompatibel</p>
                </div>
              </div>

              <div className="observe-scroll opacity-0 group p-5 sm:p-6 min-h-[236px] sm:min-h-[248px] bg-[#1E3A5F] border border-[#1E3A5F] shadow-sm hover:shadow-xl transition-all duration-500 hover:-translate-y-1 flex flex-col" style={{ transitionDelay: '100ms' }}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-[#9B8B3E] text-white rounded-full shadow-md group-hover:scale-105 transition-transform duration-300">
                    <Camera className="h-6 w-6" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">2. Bild auswählen</h3>
                <p className="text-sm text-gray-200 mb-3">Sieh dir deine Vorschau mit Wasserzeichen an und speichere Favoriten für später.</p>
                <div className="grid sm:grid-cols-2 gap-2 text-sm text-slate-200 mt-auto">
                  <p className="inline-flex items-center gap-2"><Camera className="h-4 w-4 text-[#D7C173]" />Hohe Bildqualität</p>
                  <p className="inline-flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-[#D7C173]" />Direkt in den Warenkorb</p>
                </div>
              </div>

              <div className="observe-scroll opacity-0 group p-5 sm:p-6 min-h-[236px] sm:min-h-[248px] bg-gradient-to-br from-white to-[#F4F6FA] border border-[#DCE3ED] shadow-sm hover:shadow-xl transition-all duration-500 hover:-translate-y-1 flex flex-col" style={{ transitionDelay: '200ms' }}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-[#9B8B3E] text-white rounded-full shadow-md group-hover:scale-105 transition-transform duration-300">
                    <ShoppingBag className="h-6 w-6" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">3. Kaufen und teilen</h3>
                <p className="text-sm text-gray-600 mb-3">Nach dem Checkout ist dein Foto sofort freigeschaltet - bereit für Download und Social Share.</p>
                <div className="grid sm:grid-cols-2 gap-2 text-sm text-gray-700 mt-auto">
                  <p className="inline-flex items-center gap-2"><Download className="h-4 w-4 text-[#9B8B3E]" />Sofortiger Download</p>
                  <p className="inline-flex items-center gap-2"><Share2 className="h-4 w-4 text-[#9B8B3E]" />Teilen mit 1 Klick</p>
                </div>
              </div>
            </div>

            <div className="observe-scroll opacity-0 border-2 border-[#9B8B3E] bg-white shadow-lg overflow-hidden lg:sticky lg:top-24" style={{ transitionDelay: '300ms' }}>
              <div className="bg-[#1E3A5F] text-white p-6">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Dashboard</p>
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/50 text-emerald-200 text-[11px] font-semibold">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                    </span>
                    {liveBadgeLabel}
                  </span>
                </div>
                <h3 className="text-3xl font-bold flex items-center gap-3">
                  <Medal className="h-8 w-8 text-[#D7C173]" />
                  Tagesranking
                </h3>
                <p className="mt-2 text-xs text-slate-300">
                  Reset um 07:00 Uhr in: <span className="font-semibold text-white">{resetCountdown}</span>
                </p>
              </div>

              <ul className="divide-y divide-gray-200">
                {Array.from({ length: RANKING_SLOTS }).map((_, index) => {
                  const entry = publicRanking[index];
                  if (!entry) {
                    return (
                      <li key={`empty-rank-${index}`} className="p-5 flex items-center justify-between gap-4 bg-gray-50/60">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-12 w-12 rounded-full bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-sm font-semibold text-gray-400">
                            -
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-400 truncate">#{index + 1} Platz frei</p>
                            <p className="text-xs text-gray-400">Noch kein Eintrag heute</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-bold text-gray-400 inline-flex items-center gap-1">
                            <Gauge className="h-4 w-4" />
                            --.-- km/h
                          </p>
                        </div>
                      </li>
                    );
                  }

                  const name = entry.display_name?.trim() || `Fahrer/in ${index + 1}`;
                  const avatar = resolveAvatarUrl(entry.avatar_url);
                  const speed = typeof entry.speed_kmh === 'number' ? entry.speed_kmh : 0;
                  const initials =
                    name
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase() ?? '')
                      .join('') || 'F';

                  return (
                    <li key={entry.id ?? `rank-${index}`} className="p-5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-12 w-12 rounded-full bg-slate-200 border border-slate-300 overflow-hidden shrink-0 flex items-center justify-center text-sm font-semibold text-slate-700">
                          {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : initials}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">
                            #{index + 1} {name}
                          </p>
                          <p className="text-xs text-gray-500">Heute im Plosebob Ranking</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-[#1E3A5F] inline-flex items-center gap-1">
                          <Gauge className="h-4 w-4" />
                          {speed.toFixed(2)} km/h
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="px-6 py-5 bg-[#F8F6EE] border-t border-[#E8DFC0]">
                <p className="text-[#1E3A5F] font-semibold mb-3">Willst du auch hier auftauchen?</p>
                <a
                  href="#calendar"
                  className="inline-flex items-center bg-[#9B8B3E] text-white px-5 py-3 font-semibold hover:bg-[#8A7A35] transition"
                >
                  Kaufe jetzt dein Bild
                </a>
                {rankingLoadError && <p className="text-xs text-red-600 mt-3">{rankingLoadError}</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative bg-white overflow-hidden" style={{ height: '200px' }}>
        <svg className="absolute bottom-0 w-full h-full" viewBox="0 0 1440 200" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M0,200 L0,150 L300,120 L500,80 L650,100 L800,60 L950,90 L1100,70 L1300,110 L1440,90 L1440,200 Z" fill="#D1D5DB" opacity="0.5"/>
        </svg>
      </section>

      <section className="bg-[#9B8B3E] py-4 overflow-hidden">
        <div className="whitespace-nowrap">
          <div className="inline-block animate-scroll">
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
            <span className="text-white text-xl font-bold mx-8">DIE KABINENBAHN PLOSE SCHLIESST UM 17:00 UHR</span>
          </div>
        </div>
      </section>

      <PhotoShopSection />

      <section className="relative bg-gradient-to-b from-white to-gray-50 overflow-hidden" style={{ height: '250px' }}>
        <svg className="absolute bottom-0 w-full h-full" viewBox="0 0 1440 250" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M0,250 L0,170 L250,130 L450,90 L600,110 L750,70 L900,100 L1050,80 L1200,120 L1440,95 L1440,250 Z" fill="#D1D5DB" opacity="0.5"/>
        </svg>
      </section>

      <section className="py-16 bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
            <p className="text-gray-600 text-center md:text-left">
              Dieses System wird in Kooperation mit <span className="font-semibold">Liftpictures Fotosysteme</span> realisiert – Spezialist für Fotoanlagen an Freizeitattraktionen.
            </p>
            <div className="flex items-center">
              <img
                src="/assets/Liftpicutures Logo alt.jpg"
                alt="Liftpictures Logo"
                className="h-16 object-contain"
              />
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-slate-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-bold text-lg mb-4">Navigation</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-300 hover:text-white transition">Sommer</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Winter</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Öffnungszeiten & Preise</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Hotels</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-lg mb-4">Service</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-300 hover:text-white transition">Kontakt</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Jobs</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Presse</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-lg mb-4">Rechtliches</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-300 hover:text-white transition">Impressum</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">Datenschutz</a></li>
                <li><a href="#" className="text-gray-300 hover:text-white transition">AGB</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-lg mb-4">Partner</h4>
              <ul className="space-y-2">
                <li>
                  <a href="https://www.liftpictures.de" target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-white transition flex items-center space-x-2">
                    <Camera className="h-4 w-4" />
                    <span>Technikpartner: Liftpictures</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-700 pt-8 text-center text-gray-400">
            <p>&copy; 2025 Plose AG. Alle Rechte vorbehalten.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
