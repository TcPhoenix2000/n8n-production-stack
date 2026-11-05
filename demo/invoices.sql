-- Table for the AI invoice extractor demo workflow.
-- Run once:  docker compose exec -T postgres psql -U n8n -d n8n < shared/demo/invoices.sql

CREATE SCHEMA IF NOT EXISTS demo;

CREATE TABLE IF NOT EXISTS demo.invoices (
    id              serial PRIMARY KEY,
    received_at     timestamptz NOT NULL DEFAULT now(),
    source          text,
    file_name       text,
    supplier_name   text,
    supplier_vat    text,
    vat_valid       boolean,
    invoice_number  text,
    invoice_date    date,
    due_date        date,
    currency        char(3),
    net_amount      numeric(12, 2),
    vat_amount      numeric(12, 2),
    total_amount    numeric(12, 2),
    iban            text,
    needs_review    boolean NOT NULL DEFAULT false,
    review_reasons  text,
    raw             jsonb
);

CREATE INDEX IF NOT EXISTS invoices_needs_review_idx ON demo.invoices (needs_review) WHERE needs_review;
