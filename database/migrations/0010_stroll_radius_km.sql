alter table if exists strolls
  add column if not exists radius_km integer;

update strolls
set radius_km = 10
where radius_km is null;

alter table if exists strolls
  alter column radius_km set default 10;

alter table if exists strolls
  add constraint strolls_radius_km_check
  check (radius_km is null or radius_km between 1 and 100);
