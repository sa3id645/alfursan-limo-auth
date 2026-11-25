-- =====================================================================
-- الفرسان ليموزين - سكربت قاعدة البيانات والصلاحيات الكامل (Supabase SQL)
-- ملاحظة: غيّر الإيميل في قسم (5) إلى بريد الأدمن الفعلي قبل التنفيذ
-- =====================================================================

-- 1. جدول الرحلات
create table if not exists public.trips (
  id text primary key,
  date text,
  car text,
  driver text,
  from_loc text,
  to_loc text,
  fare numeric default 0,
  collection text,
  collected numeric default 0,
  custody numeric default 0,
  fuel numeric default 0,
  tolls numeric default 0,
  permits numeric default 0,
  other numeric default 0,
  wage numeric default 0,
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz default now()
);

alter table public.trips
  add column if not exists created_by uuid references auth.users(id) default auth.uid(),
  add column if not exists created_at timestamptz default now();

-- 2. جدول ملفات المستخدمين والأدوار (admin / user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists role text not null default 'user',
  add column if not exists created_at timestamptz default now();

-- إنشاء صف تلقائي في profiles لأي مستخدم جديد في auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- مزامنة أي مستخدمين موجودين مسبقاً في auth.users داخل profiles
insert into public.profiles (id, email, role)
select u.id, u.email, 'user'
from auth.users u
on conflict (id) do update
  set email = coalesce(excluded.email, public.profiles.email);

-- دالة للتحقق هل المستخدم الحالي أدمن أم لا
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and lower(trim(role)) = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- 3. تفعيل RLS وسياسات جدول profiles
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_policy" on public.profiles;
drop policy if exists "profiles_insert_policy" on public.profiles;
drop policy if exists "profiles_update_policy" on public.profiles;

-- كل مستخدم مسجل يقرأ ملفه الشخصي، والأدمن يقرأ الكل
create policy "profiles_select_policy"
on public.profiles
for select
to authenticated
using (
  id = auth.uid() or public.is_admin()
);

-- السماح بإنشاء صف للمستخدم الحالي عند تسجيل الدخول كدور 'user' فقط
create policy "profiles_insert_policy"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid() and lower(trim(role)) = 'user'
);

-- الأدمن فقط يستطيع تعديل الأدوار
create policy "profiles_update_policy"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 4. تفعيل RLS وسياسات جدول trips
alter table public.trips enable row level security;

drop policy if exists "trips_select_policy" on public.trips;
drop policy if exists "trips_insert_policy" on public.trips;
drop policy if exists "trips_update_policy" on public.trips;
drop policy if exists "trips_delete_policy" on public.trips;

-- القراءة: الأدمن يرى كل الرحلات، والمستخدم العادي يرى الرحلات التي أضافها
create policy "trips_select_policy"
on public.trips
for select
to authenticated
using (
  public.is_admin() or created_by = auth.uid()
);

-- الإضافة: أي مستخدم مسجل دخول يقدر يسجل رحلة جديدة
create policy "trips_insert_policy"
on public.trips
for insert
to authenticated
with check (
  auth.uid() is not null
);

-- التعديل والحذف: للأدمن فقط
create policy "trips_update_policy"
on public.trips
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "trips_delete_policy"
on public.trips
for delete
to authenticated
using (public.is_admin());

-- دالة لجلب آخر الرحلات المسجلة (تُستخدم لعرض آخر الرحلات للمستخدم العادي)
create or replace function public.get_recent_trips(lim int default 10)
returns setof public.trips
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.trips
  order by created_at desc nulls last, date desc
  limit greatest(1, least(coalesce(lim, 10), 50));
$$;

grant execute on function public.get_recent_trips(int) to authenticated;

-- 5. ترقية حساب الأدمن (غيّر الإيميل إلى بريدك الحقيقي)
update public.profiles
set role = 'admin'
where lower(trim(email)) = lower(trim('admin@example.com'));

-- 6. استعلام للتحقق من الأدوار الحالية
select id, email, role
from public.profiles
order by created_at desc;
