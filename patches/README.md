# Correctifs pour `dextermex/morada`

Cette session n'a pas les droits d'écriture sur le dépôt Morada : son accès
GitHub est limité à `dextermex/gestion`. Les changements qui touchent Morada
sont donc livrés ici, en correctifs prêts à appliquer.

## `morada-sso-etape1.patch`

Étape 1 de la session partagée. Deux fichiers, 157 lignes ajoutées, zéro
ligne supprimée.

- **`src/lib/sessionCookie.ts`** (nouveau) : copie conforme de
  `src/lib/sessionCookie.ts` de ce dépôt, couvert par treize tests dans
  `src/lib/__tests__/sessionCookie.test.ts`.
- **`src/lib/authClient.ts`** : une ligne `storage:` dans `createClient`, et
  l'effacement du cookie partagé dans `signOutEverywhere`.

`flowType`, `detectSessionInUrl`, `autoRefreshToken`, `persistSession` et
`storageKey` ne changent pas. Le seul changement est l'endroit où la session
est rangée, et le miroir localStorage reste actif : annuler ce correctif ne
déconnecte personne.

### Appliquer

```bash
cd /chemin/vers/morada
git checkout -b sso-etape1
git apply --stat patches/morada-sso-etape1.patch   # aperçu
git apply patches/morada-sso-etape1.patch
npx tsc --noEmit && npx next lint && npm run build
```

### Vérifié avant livraison

Le correctif a été appliqué sur une copie locale de `dextermex/morada`
(branche par défaut, `434a4e8`), puis :

| Vérification | Résultat |
| --- | --- |
| `npx tsc --noEmit` | aucune erreur |
| `npx next lint` | aucun avertissement |
| `npm run build` | réussi, toutes les routes compilées |

La copie de travail a ensuite été remise à son état d'origine : rien n'a été
commité ni poussé sur Morada.

### Annuler

```bash
git apply -R patches/morada-sso-etape1.patch
```

La session est toujours dans localStorage grâce au miroir : personne n'est
déconnecté.
