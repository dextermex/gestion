-- 0016 · La photo d'un lot
-- Appliqué le 2026-09-21 (migration `gestion_unit_photo`).
--
-- La page d'un immeuble montre ses lots en cartes, photo en premier, comme
-- la page Biens montre les biens. Un lot n'avait pas de photo : la colonne
-- est ajoutée, nullable, et le chemin vit dans le même dossier du bucket
-- `gestion-media` que la photo du bien (`<org>/<bien>/<uuid>.<ext>`), donc
-- sous les mêmes policies de stockage (0011 pour le gestionnaire, 0015 pour
-- le locataire du bien). `my_home()` est recréée pour préférer la photo du
-- lot à celle du bien : le locataire voit d'abord son logement.
--
-- ADDITIF : aucune table renommée ni supprimée, une colonne nullable, une
-- fonction recréée à signature identique.
-- Réversible : drop de la colonne, puis my_home() telle qu'en 0015.

alter table gestion.units add column if not exists photo_url text;
comment on column gestion.units.photo_url is
  'Chemin dans le bucket gestion-media (<org>/<bien>/<uuid>.<ext>), jamais une URL. Null : la photo du bien fait foi.';

drop function if exists gestion.my_home();
create function gestion.my_home()
returns table (
  lease_id                  uuid,
  org_id                    uuid,
  unit_id                   uuid,
  property_id               uuid,
  lease_status              text,
  lease_type                text,
  start_date                date,
  end_date                  date,
  rent_cents                integer,
  charges_cents             integer,
  charges_regime            text,
  payment_day               int,
  rf_reference              text,
  furnished                 boolean,
  colocation                boolean,
  last_adjustment_on        date,
  previous_rent_cents       integer,
  unit_label                text,
  unit_floor                text,
  unit_area_sqm             numeric,
  unit_rooms                numeric,
  unit_bedrooms             int,
  property_name             text,
  property_address          jsonb,
  property_commune          text,
  energy_class              text,
  cpe_issued_on             date,
  syndic_name               text,
  smoke_detectors_confirmed boolean,
  photo_url                 text
)
language sql stable security definer
set search_path = ''
as $$
  select l.id, l.org_id, u.id, p.id, l.status, l.lease_type, l.start_date, l.end_date,
         l.rent_cents, l.charges_cents, l.charges_regime, l.payment_day,
         l.rf_reference, l.furnished, l.colocation, l.last_adjustment_on, l.previous_rent_cents,
         u.label, u.floor, u.area_sqm, u.rooms, u.bedrooms,
         p.name, p.address, p.commune, p.energy_class, p.cpe_issued_on,
         p.syndic_name, p.smoke_detectors_confirmed, coalesce(u.photo_url, p.photo_url)
    from gestion.leases l
    join gestion.units u on u.id = l.unit_id
    join gestion.properties p on p.id = u.property_id
   where gestion.portal_tenant_lease(l.id)
   order by l.start_date desc;
$$;
comment on function gestion.my_home() is
  'Le logement du locataire, colonnes restreintes. Seule porte d''entrée du portail locataire vers properties, units et leases. La photo est celle du lot, sinon celle du bien.';
revoke all on function gestion.my_home() from public, anon;
grant execute on function gestion.my_home() to authenticated;
