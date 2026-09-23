ALTER TABLE competitions
ADD COLUMN management_device_id INTEGER;

CREATE INDEX IF NOT EXISTS
idx_competitions_management_device
ON competitions (
  management_device_id
);
