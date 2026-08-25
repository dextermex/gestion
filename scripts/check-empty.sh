#!/usr/bin/env bash
# Crawls every route of Morada Gestion against an account that has no data,
# which is what a real signed-in account looks like today.
set -u
BASE="http://127.0.0.1:4321"

ROUTES="/app /app/biens /app/baux /app/loyers /app/charges /app/compteurs
/app/conformite /app/contacts /app/contrats /app/documents /app/finance
/app/fiscalite /app/garanties /app/indexation /app/messages /app/workflows
/app/banque /app/aml /app/biens/nouveau /locataire /locataire/bail
/locataire/paiements /locataire/demandes /connexion"

fail=0
for r in $ROUTES; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$r")
  if [ "$code" = "200" ]; then
    printf "  ok   %s\n" "$r"
  else
    printf "  %-4s %s\n" "$code" "$r"
    fail=1
  fi
done

echo
echo "Occurrences de noms de demonstration dans le rendu :"
for r in /app /app/biens /app/finance /app/fiscalite /app/aml /app/conformite; do
  n=$(curl -s "$BASE$r" | grep -coiE "reuter|majerus|beaulieu|lambert|faber|kirchberg")
  printf "  %-20s %s\n" "$r" "$n"
done

exit $fail
