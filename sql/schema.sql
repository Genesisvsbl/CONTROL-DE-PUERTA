-- ============================================================
-- ControlPuerta · Esquema de base de datos (Supabase / Postgres)
-- Cómo usar:
--   1) Entra a tu proyecto en https://supabase.com
--   2) Menú izquierdo → SQL Editor → New query
--   3) Pega TODO este archivo y presiona "Run"
-- ============================================================

-- Tabla principal de registros de vehículos
create table if not exists public.registros (
  id             uuid primary key default gen_random_uuid(),
  folio          text,
  nombre         text not null,
  cedula         text not null,
  placa          text not null,
  motivo         text,
  tipo           text,
  lat            double precision,
  lng            double precision,
  gps_sim        boolean default false,
  estado         text not null default 'puerta',   -- puerta | planta | cerrado | rechazado
  t_puerta       timestamptz default now(),
  t_ingreso      timestamptz,
  t_salida       timestamptz,
  salida_tipo    text,
  salida_detalle text,
  salida_doc     text,
  created_at     timestamptz default now()
);

create index if not exists registros_estado_idx  on public.registros (estado);
create index if not exists registros_tpuerta_idx on public.registros (t_puerta desc);

-- ------------------------------------------------------------
-- Tiempo real: habilita que la app reciba cambios al instante
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.registros;

-- ------------------------------------------------------------
-- Seguridad (RLS)
-- Para una app interna sencilla con la llave pública (anon),
-- se permiten las operaciones necesarias. Puedes endurecer
-- esto más adelante (por ejemplo, exigir login).
-- ------------------------------------------------------------
alter table public.registros enable row level security;

drop policy if exists "cp_select" on public.registros;
drop policy if exists "cp_insert" on public.registros;
drop policy if exists "cp_update" on public.registros;

create policy "cp_select" on public.registros for select using (true);
create policy "cp_insert" on public.registros for insert with check (true);
create policy "cp_update" on public.registros for update using (true) with check (true);

-- Listo. Copia tu Project URL y anon key en config.js
