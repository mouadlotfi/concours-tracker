ALTER TABLE concours ADD COLUMN notifiedAt DATETIME;

-- Backfill existing rows so the first notification run after this migration does
-- not email every already-known listing to all subscribers.
UPDATE concours SET notifiedAt = CURRENT_TIMESTAMP WHERE notifiedAt IS NULL;
