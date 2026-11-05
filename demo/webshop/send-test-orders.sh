#!/bin/sh
# Sends the sample Shopify orders and refund to the n8n webhook, then a duplicate
# of order #1001 (should be ignored), then asks for today's summary.
#
# Usage: N8N_URL=https://n8n.example.com SHOP_TOKEN=... sh send-test-orders.sh
set -eu
cd "$(dirname "$0")/samples"

: "${N8N_URL:?Set N8N_URL, e.g. https://n8n.example.com}"
: "${SHOP_TOKEN:?Set SHOP_TOKEN (the X-Shop-Token header value)}"

post() {
  printf '%-34s ' "$1"
  curl -sk -X POST -H "Content-Type: application/json" -H "X-Shop-Token: ${SHOP_TOKEN}" \
    --data @"$1" "${N8N_URL%/}/webhook/shop-orders"
  echo
}

for f in 1-order-1001.json 2-order-1002-low-stock.json 3-order-1003-total-mismatch.json 4-refund-1001-mug.json; do
  post "$f"
done

echo "--- duplicate (Shopify retry) of order #1001:"
post 1-order-1001.json

echo "--- today's summary:"
curl -sk -H "X-Shop-Token: ${SHOP_TOKEN}" "${N8N_URL%/}/webhook/shop-summary"
echo
