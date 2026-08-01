-- ============================================================
-- ControlPuerta · Esquema de base de datos (Supabase / Postgres)
-- Cómo usar:
--   1) Entra a tu proyecto en https://supabase.com
--   2) Menú izquierdo → SQL Editor → New query
--   3) Pega TODO este archivo y presiona "Run"
-- (Se puede correr varias veces sin problema.)
-- ============================================================

-- ------------------------------------------------------------
-- Tabla de registros de vehículos
-- ------------------------------------------------------------
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
-- Tabla de USUARIOS de portería (creados por el administrador)
-- ------------------------------------------------------------
create table if not exists public.usuarios (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  pin        text not null,
  cargo      text,
  rol        text default 'porteria',   -- 'porteria' | 'admin' (premium)
  activo     boolean default true,
  created_at timestamptz default now()
);
create index if not exists usuarios_pin_idx on public.usuarios (pin);
-- por si la tabla ya existía sin la columna rol:
alter table public.usuarios add column if not exists rol text default 'porteria';

-- ------------------------------------------------------------
-- Tiempo real (idempotente: no falla si ya estaba agregada)
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.registros;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.usuarios;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- Seguridad (RLS). App interna con la llave pública (anon).
-- ------------------------------------------------------------
alter table public.registros enable row level security;
alter table public.usuarios  enable row level security;

drop policy if exists "cp_select" on public.registros;
drop policy if exists "cp_insert" on public.registros;
drop policy if exists "cp_update" on public.registros;
create policy "cp_select" on public.registros for select using (true);
create policy "cp_insert" on public.registros for insert with check (true);
create policy "cp_update" on public.registros for update using (true) with check (true);

drop policy if exists "us_select" on public.usuarios;
drop policy if exists "us_insert" on public.usuarios;
drop policy if exists "us_update" on public.usuarios;
drop policy if exists "us_delete" on public.usuarios;
create policy "us_select" on public.usuarios for select using (true);
create policy "us_insert" on public.usuarios for insert with check (true);
create policy "us_update" on public.usuarios for update using (true) with check (true);
create policy "us_delete" on public.usuarios for delete using (true);

-- ------------------------------------------------------------
-- Permisos de tabla para el rol público (anon) y autenticado
-- (necesario para que la app pueda leer/escribir con la llave publishable)
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.registros to anon, authenticated;
grant select, insert, update, delete on public.usuarios  to anon, authenticated;

-- Listo.
