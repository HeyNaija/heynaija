-- Runs once, when the Postgres data directory is first created.
-- Kratos keeps its identities in its own database, separate from the app's.
CREATE DATABASE kratos;
