-- Explicit rollback for a DISPOSABLE empty Payment database only.
-- Not a Flyway migration and never executed automatically. Backup before any rollback.
DROP TABLE payment_outbox;
DROP TABLE payment_inbox;
DROP TABLE provider_payment;
DROP TABLE payment_preference;
DROP TABLE payment_intent;
-- Flyway history is deliberately untouched. Restore the whole database backup for a real rollback.
