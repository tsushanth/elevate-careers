-- A dominant regioned city entry also serves the city's regionless job_feed rows.
-- Set by rebuildGeoPlaces (src/services/geoPlace.js); read by the feed query.
-- Additive and idempotent; deploy before the API that writes it.
alter table public.geo_place add column if not exists absorbs_regionless boolean not null default false;
