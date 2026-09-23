ALTER TABLE tournaments
ADD COLUMN management_device_id INTEGER;

CREATE INDEX IF NOT EXISTS
idx_tournaments_management_device
ON tournaments (
  management_device_id
);
