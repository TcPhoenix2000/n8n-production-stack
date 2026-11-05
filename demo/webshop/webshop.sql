-- Tables for the webshop -> accounting demo.
-- Run once:  docker compose exec -T postgres psql -U n8n -d n8n < shared/demo/webshop/webshop.sql

CREATE SCHEMA IF NOT EXISTS demo;

-- Product catalogue with stock (stands in for the shop's inventory)
CREATE TABLE IF NOT EXISTS demo.products (
    sku                  text PRIMARY KEY,
    title                text NOT NULL,
    price                numeric(10, 2) NOT NULL,
    vat_rate             numeric(4, 2) NOT NULL,
    stock                integer NOT NULL,
    low_stock_threshold  integer NOT NULL DEFAULT 3
);

-- Separate, gap-free numbering for invoices and credit notes
CREATE SEQUENCE IF NOT EXISTS demo.shop_invoice_seq;
CREATE SEQUENCE IF NOT EXISTS demo.shop_credit_note_seq;

CREATE TABLE IF NOT EXISTS demo.shop_invoices (
    id              serial PRIMARY KEY,
    doc_number      text UNIQUE,
    doc_type        text NOT NULL CHECK (doc_type IN ('invoice', 'credit_note')),
    shop            text,
    shop_order_id   text NOT NULL,
    shop_order_name text,
    shop_refund_id  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    order_date      timestamptz,
    customer_name   text,
    customer_email  text,
    country         text,
    currency        char(3),
    net_amount      numeric(12, 2),
    vat_amount      numeric(12, 2),
    total_amount    numeric(12, 2),
    vat_breakdown   jsonb,
    lines           jsonb,
    needs_review    boolean NOT NULL DEFAULT false,
    review_reasons  text,
    -- Shopify retries webhooks: the same order/refund is only booked once
    CONSTRAINT shop_invoices_once UNIQUE NULLS NOT DISTINCT (shop_order_id, doc_type, shop_refund_id)
);

CREATE OR REPLACE FUNCTION demo.set_shop_doc_number() RETURNS trigger AS $fn$
BEGIN
    IF NEW.doc_number IS NULL THEN
        IF NEW.doc_type = 'credit_note' THEN
            NEW.doc_number := 'CN' || to_char(now(), 'YYYY') || '-' || lpad(nextval('demo.shop_credit_note_seq')::text, 5, '0');
        ELSE
            NEW.doc_number := 'INV' || to_char(now(), 'YYYY') || '-' || lpad(nextval('demo.shop_invoice_seq')::text, 5, '0');
        END IF;
    END IF;
    RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shop_invoices_doc_number ON demo.shop_invoices;
CREATE TRIGGER shop_invoices_doc_number
    BEFORE INSERT ON demo.shop_invoices
    FOR EACH ROW EXECUTE FUNCTION demo.set_shop_doc_number();

CREATE TABLE IF NOT EXISTS demo.shop_alerts (
    id          serial PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now(),
    kind        text NOT NULL,
    sku         text,
    message     text NOT NULL
);

-- Demo catalogue: a fictitious coffee webshop (coffee 6% VAT, goods 21%)
INSERT INTO demo.products (sku, title, price, vat_rate, stock, low_stock_threshold) VALUES
    ('KK-BEANS-250', 'Kustkoffie bonen 250 g', 12.50, 6, 40, 5),
    ('KK-MUG',       'Kustkoffie mok',          14.95, 21, 12, 3),
    ('KK-GRINDER',   'Handmolen',               49.00, 21, 3, 3)
ON CONFLICT (sku) DO NOTHING;
