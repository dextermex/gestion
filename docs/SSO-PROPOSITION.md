# Session partagée sur `.morada.lu` — proposition, non déployée

Objectif : je me connecte sur morada.lu, je clique sur Morada Gestion,
`app.morada.lu` s'ouvre et me reconnaît. Et l'inverse.

Rien de ce document n'est déployé. C'est le code exact, ses effets sur Morada
et Morada Pro, et la marche arrière.

## Pourquoi ça ne marche pas aujourd'hui

`src/lib/authClient.ts` de Morada crée le client Supabase avec
`storageKey: "morada_auth"` et le stockage par défaut, qui est
`window.localStorage`. Or localStorage est cloisonné par **origine** :
`https://morada.lu` et `https://app.morada.lu` sont deux origines
différentes, donc deux stockages qui ne se voient pas. Aucun réglage de
Supabase ne change cela : c'est une règle du navigateur.

Le seul stockage que deux sous-domaines partagent nativement est le **cookie
posé sur le domaine parent**, `.morada.lu`.

## Ce que je ne propose pas

- **Passer le jeton dans l'URL.** Vous l'aviez exclu, et vous aviez raison :
  l'URL part dans l'historique, le `Referer` et les journaux du serveur.
- **`@supabase/ssr` et `createBrowserClient`.** C'est pourtant l'outil fait
  pour ça, il découpe les cookies tout seul, et j'ai commencé par là. Mais en
  lisant la version 0.12.5 j'ai trouvé ceci, en dur, non désactivable :

  ```js
  auth: { ...options?.auth, flowType: "pkce", ... }
  ```

  Morada tourne aujourd'hui en flux implicite. Basculer en PKCE change la
  forme des liens envoyés par e-mail : `#access_token` devient `?code=`.
  `src/app/auth/reset/page.tsx` écoute `PASSWORD_RECOVERY` sur
  `onAuthStateChange` et les liens de réinitialisation déjà envoyés
  cesseraient de fonctionner. Ce n'est pas un risque à prendre sur le chemin
  « mot de passe oublié » d'une application en production.

## Ce que je propose

Garder `createClient` de `@supabase/supabase-js` exactement comme aujourd'hui,
et lui donner un `storage` maison qui écrit dans un cookie de domaine parent.
`flowType`, `detectSessionInUrl`, `autoRefreshToken` et `storageKey` ne
bougent pas d'un caractère. Le seul changement est **l'endroit où la session
est rangée**.

### Fichier nouveau, identique dans les deux dépôts

`src/lib/sessionCookie.ts`

```ts
/**
 * Session storage backed by a cookie on the parent domain, so morada.lu and
 * app.morada.lu see the same Supabase session. localStorage is scoped to one
 * origin and can never be shared between the two.
 */

const CHUNK = 3000;              // room under the 4096-byte per-cookie limit
const MAX_CHUNKS = 8;
const ONE_YEAR = 60 * 60 * 24 * 365;
const B64 = "b64.";              // marks an encoded value, so raw ones still read

/** Cookies are shared across subdomains only when scoped to the parent. */
function domainAttr(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  return host === "morada.lu" || host.endsWith(".morada.lu")
    ? "; domain=.morada.lu"
    : ""; // localhost and preview deployments stay host-scoped
}

/**
 * A session is JSON with quotes, braces and accents. Percent-encoding it
 * inflates it unpredictably (up to sixfold on accented text) and blows past
 * the per-cookie limit; base64url inflates by exactly a third and produces
 * only characters a cookie accepts verbatim.
 */
function encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return B64 + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(stored: string): string {
  if (!stored.startsWith(B64)) return stored;
  const binary = atob(stored.slice(B64.length).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

function writeCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    `${encodeURIComponent(name)}=${value}` +
    `; path=/; max-age=${maxAge}; samesite=lax${secure}${domainAttr()}`;
}

function eraseCookie(name: string): void {
  writeCookie(name, "", 0);
}

/**
 * Even base64url, a session runs past the per-cookie limit, so it is split
 * across `<key>.0`, `<key>.1`… and reassembled on read.
 */
export function createCookieStorage(opts: { mirrorToLocalStorage: boolean }) {
  const local = (): Storage | null => {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null; // private browsing with storage disabled
    }
  };

  const readChunked = (key: string): string | null => {
    const whole = readCookie(key);
    if (whole !== null) return whole;
    let out = "";
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const part = readCookie(`${key}.${i}`);
      if (part === null) break;
      out += part;
    }
    return out === "" ? null : out;
  };

  const clearChunks = (key: string): void => {
    eraseCookie(key);
    for (let i = 0; i < MAX_CHUNKS; i++) eraseCookie(`${key}.${i}`);
  };

  const storage = {
    getItem(key: string): string | null {
      const stored = readChunked(key);
      if (stored !== null) {
        try {
          return decode(stored);
        } catch {
          // A truncated or hand-edited cookie reads as "no session" rather
          // than throwing inside the Supabase client.
          clearChunks(key);
          return null;
        }
      }
      // Nobody is logged out by the switch: an existing localStorage session
      // is adopted on first read and promoted to the shared cookie.
      const legacy = local()?.getItem(key) ?? null;
      if (legacy !== null) storage.setItem(key, legacy);
      return legacy;
    },

    setItem(key: string, value: string): void {
      clearChunks(key);
      const encoded = encode(value);
      if (encoded.length <= CHUNK) {
        writeCookie(key, encoded, ONE_YEAR);
      } else {
        for (let i = 0; i * CHUNK < encoded.length; i++) {
          writeCookie(`${key}.${i}`, encoded.slice(i * CHUNK, (i + 1) * CHUNK), ONE_YEAR);
        }
      }
      // Phase 1 keeps localStorage in step, so reverting the deploy logs
      // nobody out. Phase 3 drops this.
      if (opts.mirrorToLocalStorage) {
        try {
          local()?.setItem(key, value);
        } catch {
          /* quota or private browsing — the cookie is the source of truth */
        }
      }
    },

    removeItem(key: string): void {
      clearChunks(key);
      try {
        local()?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };

  return storage;
}
```

### Le diff dans Morada

`src/lib/authClient.ts`, trois lignes ajoutées, aucune supprimée :

```diff
  import { createClient, type SupabaseClient } from "@supabase/supabase-js";
+ import { createCookieStorage } from "@/lib/sessionCookie";

  ...

      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: typeof window !== "undefined",
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: STORAGE_KEY,
+         storage: createCookieStorage({ mirrorToLocalStorage: true }),
        },
      });
```

Et dans `signOutEverywhere`, la déconnexion doit effacer le cookie partagé :

```diff
    await c.auth.signOut();
    if (typeof window !== "undefined") {
+     createCookieStorage({ mirrorToLocalStorage: true }).removeItem(STORAGE_KEY);
        try {
          window.localStorage.removeItem("morada_pro_agency");
```

C'est tout. `getAuthClient()` est le point d'entrée unique : les neuf fichiers
qui l'importent (Morada Pro, l'espace client, l'ancien `/gestion`, le portail,
le CRM) héritent du changement sans être touchés.

### Le diff dans Morada Gestion

Le même `sessionCookie.ts`, plus un `src/lib/authClient.ts` neuf qui reprend
mot pour mot celui de Morada : même URL de projet, même clé publiable, même
`storageKey: "morada_auth"`. Rien d'autre à écrire : la session est déjà là.

## Effets sur Morada et Morada Pro

| Ce qui change | Effet |
| --- | --- |
| Emplacement de la session | localStorage → cookie `.morada.lu`, avec miroir localStorage en phase 1 |
| Utilisateurs déjà connectés | Aucune déconnexion : `getItem` adopte la session localStorage existante |
| `flowType`, réinitialisation de mot de passe, OAuth | Inchangés, c'est tout l'intérêt de ne pas passer par `@supabase/ssr` |
| Morada Pro | Aucun changement de code, il passe par `getAuthClient()` |
| Ancien `morada.lu/gestion` | Aucun changement de code, même client |
| RLS, tables, migrations | Rien. Ce chantier ne touche pas la base. |

Trois points de vigilance, que je préfère écrire noir sur blanc :

1. **Le cookie part avec chaque requête vers `*.morada.lu`.** Trois kilooctets
   environ, sur toutes les requêtes de tous les sous-domaines. Il faut donc
   éviter de servir les images et les fichiers statiques depuis un
   sous-domaine de morada.lu, sans quoi on paie ce surcoût sur chaque asset.
2. **Tout sous-domaine de morada.lu pourra lire la session en JavaScript.**
   C'était déjà vrai pour localStorage sur son origine, mais le périmètre
   s'élargit. Concrètement : ne jamais héberger de contenu tiers non maîtrisé
   sur un `*.morada.lu`.
3. **`httpOnly` est impossible.** Le SDK Supabase lit la session en
   JavaScript ; un cookie `httpOnly` lui serait invisible. Le niveau
   d'exposition reste celui de localStorage aujourd'hui, ni plus ni moins,
   avec `secure` et `samesite=lax` en plus.

## Déploiement en trois étapes, chacune réversible

**Étape 1, sur Morada seul.** L'adaptateur écrit dans le cookie *et* dans
localStorage. Rien ne change pour l'utilisateur. Marche arrière : on annule le
commit, la session est toujours dans localStorage, personne n'est déconnecté.
C'est une étape à froid, sans effet visible, faite pour être observée
quelques jours.

**Étape 2, sur app.morada.lu.** Le même adaptateur. Le SSO fonctionne dans les
deux sens. Marche arrière : annuler le commit côté Gestion ; Morada continue
comme à l'étape 1, l'utilisateur se reconnecte une fois sur Gestion.

**Étape 3, plus tard.** `mirrorToLocalStorage: false`. À ne faire que
lorsqu'un retour en arrière n'est plus envisagé. Marche arrière : remettre le
miroir à `true`, ce qui reconstruit localStorage au premier écrit de session.

## Comment vérifier que ça marche

1. Connexion sur morada.lu, puis dans la console :
   `document.cookie.split('; ').filter(c => c.startsWith('morada_auth'))`
   doit renvoyer une ou plusieurs entrées.
2. Ouvrir `app.morada.lu` : `await getAuthClient().auth.getUser()` renvoie le
   même `id` que sur morada.lu.
3. Se déconnecter depuis Gestion, revenir sur morada.lu, recharger : la
   session doit être partie des deux côtés.
4. Se connecter avec le compte A, se déconnecter, se connecter avec le compte
   B : Gestion ne doit plus rien afficher du patrimoine de A.
5. Demander une réinitialisation de mot de passe et suivre le lien reçu :
   le comportement doit être identique à aujourd'hui. C'est le test qui
   justifie de ne pas avoir pris `@supabase/ssr`.
