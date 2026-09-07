# Future migrations

`baseline/baseline.sql` is the one-file schema.

After you change the live DB, either:

1. Re-dump baseline with `../scripts/dump-supabase-baseline.sh`, or  
2. Add a numbered file here (`50-…`), run it once on live, then fold it into baseline and delete the file.

Do not put archived `01`–`49` here — they live in `../archive/migrations-01-49/`.
