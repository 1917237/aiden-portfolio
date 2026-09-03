-- Credit holds at book time may push balance below zero. Run after 40.
-- Safe to re-run (idempotent).

alter table public.profiles
  drop constraint if exists profiles_credit_balance_cents_check;

notify pgrst, 'reload schema';
