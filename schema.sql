DROP TABLE IF EXISTS concours;
CREATE TABLE concours (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  wadifaUrl TEXT NOT NULL,
  sourceUrl TEXT,
  depositDeadlineIso TEXT,
  concoursDateIso TEXT,
  details TEXT, -- JSON string
  matchReason TEXT,
  aiRelevant BOOLEAN DEFAULT NULL,
  aiReason TEXT,
  classificationVersion TEXT,
  classificationHash TEXT,
  classificationSource TEXT,
  classificationModel TEXT,
  classifiedAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS subscribers;
CREATE TABLE subscribers (
  email TEXT PRIMARY KEY,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
