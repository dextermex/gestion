# Banc d'essai de l'adaptateur de session

Le fichier `sessionCookie.ts` est **la** copie de référence du code proposé
dans `../SSO-PROPOSITION.md`. Il n'est importé par aucune page : l'application
n'utilise pas encore de session Supabase.

`run.cjs` monte un faux navigateur (un pot à cookies qui applique la limite
réelle de 4096 octets et refuse tout autre domaine que `.morada.lu`) et
vérifie onze points :

- rien à lire quand aucune session n'existe ;
- une petite session revient à l'identique, sur un seul cookie ;
- une grosse session revient à l'identique, découpée, sans dépasser la limite ;
- repasser à une petite session n'abandonne aucun morceau orphelin ;
- la déconnexion efface cookies et localStorage ;
- une session localStorage déjà présente est adoptée puis promue en cookie,
  ce qui est la garantie que personne n'est déconnecté par la bascule.

```bash
cd docs/sso-check
npx tsc sessionCookie.ts --target ES2020 --lib ES2020,DOM --module commonjs --outDir out
node run.cjs
```

Le premier jet découpait sur la longueur brute puis appliquait
`encodeURIComponent`, ce qui faisait sauter la limite à 4509 octets sur une
session accentuée. C'est ce banc qui l'a trouvé. La version actuelle encode en
base64url d'abord, dont l'inflation est constante d'un tiers.
