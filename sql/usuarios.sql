-- ============================================================
-- ControlPuerta · Solo la tabla de USUARIOS
-- Corre esto en Supabase (SQL Editor) si ya tenías la tabla de
-- registros creada y solo te falta la de usuarios.
-- ============================================================

create table if not exists public.usuarios (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  pin        text not null,
  cargo      text,
  activo     boolean default true,
  created_at timestamptz default now()
);
create index if not exists usuarios_pin_idx on public.usuarios (pin);

do $$ begin
  alter publication supabase_realtime add table public.usuarios;
exception when duplicate_object then null; end $$;

alter table public.usuarios enable row level security;
drop policy if exists "us_select" on public.usuarios;
drop policy if exists "us_insert" on public.usuarios;
drop policy if exists "us_update" on public.usuarios;
drop policy if exists "us_delete" on public.usuarios;
create policy "us_select" on public.usuarios for select using (true);
create policy "us_insert" on public.usuarios for insert with check (true);
create policy "us_update" on public.usuarios for update using (true) with check (true);
create policy "us_delete" on public.usuarios for delete using (true);

-- Permisos de tabla para el rol público (necesario para la llave publishable)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.usuarios to anon, authenticated;
