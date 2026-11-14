-- Explicit rollback for a DISPOSABLE empty Payment database only.
-- Not a Flyway migration and never executed automatically. Backup before any rollback.
DROP TABLE payment_anomaly;
DROP INDEX idx_payment_intent_checked;
ALTER TABLE payment_intent DROP COLUMN provider_checked_at;
ALTER TABLE payment_intent DROP COLUMN status_reason;
-- Flyway history is deliberately untouched. Restore the whole database backup for a real rollback.
