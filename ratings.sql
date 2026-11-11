-- Run once in Supabase: SQL Editor -> New query -> paste -> Run
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  day integer not null,
  player_id uuid not null,
  character_name text not null check (char_length(character_name) between 1 and 60),
  rating integer not null check (rating between 1 and 10),
  created_at timestamptz not null default now(),
  unique (day, player_id)              -- one rating per device per day
);

create index ratings_character_idx on public.ratings (character_name);

alter table public.ratings enable row level security;

-- the site can add ratings and read them, but player_id stays private
revoke all on public.ratings from anon;
grant insert on public.ratings to anon;
grant select (day, character_name, rating, created_at) on public.ratings to anon;

create policy "read ratings" on public.ratings
  for select to anon using (true);

-- anyone can add a rating, but only for about "today" (+/-1 day covers time zones)
create policy "add rating for today" on public.ratings
  for insert to anon
  with check (
    day between floor(extract(epoch from now()) / 86400)::int - 1
            and floor(extract(epoch from now()) / 86400)::int + 1
  );

-- the popularity list: average + vote count per character
create view public.character_popularity with (security_invoker = true) as
  select character_name,
         round(avg(rating)::numeric, 2) as avg_rating,
         count(*) as votes
  from public.ratings
  group by character_name;

revoke all on public.character_popularity from anon;
grant select on public.character_popularity to anon;