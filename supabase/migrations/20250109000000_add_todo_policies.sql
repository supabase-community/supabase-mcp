-- Enable RLS
alter table todos enable row level security;

-- Add user_id column to track ownership
alter table todos
add column user_id uuid references auth.users (id) default auth.uid () not null;

-- Create policies
create policy "Users can view their own todos" on todos for
select
  using (
    (
      select
        auth.uid () = user_id
    )
  );

create policy "Users can create their own todos" on todos for insert
with
  check (
    (
      select
        auth.uid () = user_id
    )
  );

create policy "Users can update their own todos" on todos for
update using (
  (
    select
      auth.uid () = user_id
  )
)
with
  check (
    (
      select
        auth.uid () = user_id
    )
  );

create policy "Users can delete their own todos" on todos for delete using (
  (
    select
      auth.uid () = user_id
  )
);