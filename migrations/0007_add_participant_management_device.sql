ALTER TABLE participants
ADD COLUMN management_device_id INTEGER;

CREATE INDEX IF NOT EXISTS
idx_participants_management_device
ON participants (
  management_device_id
);
