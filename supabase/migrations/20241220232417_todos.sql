create table
  todos (
    id bigint primary key generated always as identity,
    title text not null,
    description text,
    due_date date,
    is_completed boolean default false
  );

comment on table todos is 'Table to manage todo items with details such as title, description, due date, and completion status.';