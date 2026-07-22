ALTER TABLE concours ADD COLUMN classificationVersion TEXT;
ALTER TABLE concours ADD COLUMN classificationHash TEXT;
ALTER TABLE concours ADD COLUMN classificationSource TEXT;
ALTER TABLE concours ADD COLUMN classificationModel TEXT;
ALTER TABLE concours ADD COLUMN classifiedAt DATETIME;
