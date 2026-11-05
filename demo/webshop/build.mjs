// Builds the two n8n workflow JSON files for the webshop demo from readable source.
// Usage: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const here = new URL('.', import.meta.url);
const read = f => readFileSync(new URL(f, here), 'utf8');
let n = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters, id: `b2c0d1e2-0000-4000-9000-${String(++n).padStart(12, '0')}`, name, type, typeVersion, position, ...extra
});
const main = (...targets) => ({ main: [targets.map(t => ({ node: t, type: 'main', index: 0 }))] });

// ---------- Workflow 1: order / refund -> invoice / credit note ----------
const splitLines = `// One item per product line, for the stock update. Refunds put stock back.
const row = $json;
const lines = typeof row.lines === 'string' ? JSON.parse(row.lines) : (row.lines || []);
const sign = row.doc_type === 'credit_note' ? -1 : 1;
return lines.filter(l => l.sku).map(l => ({ json: { sku: l.sku, qty: sign * l.qty, doc_number: row.doc_number } }));`;

const buildAlert = `return {
  json: {
    kind: 'low_stock',
    sku: $json.sku,
    message: \`Low stock: \${$json.title} (\${$json.sku}) has \${$json.stock} left (threshold \${$json.low_stock_threshold}) after \${$('Split lines').item.json.doc_number}\`
  }
};`;

const orders = {
  name: 'Webshop orders to accounting (demo)',
  nodes: [
    node('About', 'n8n-nodes-base.stickyNote', 1, [-200, -300], {
      content: '## Webshop → accounting\n\nEvery Shopify **order** becomes a numbered **invoice**, every **refund** a **credit note** — with net/VAT per rate (6% / 21%), totals checked against the shop, and duplicates ignored when Shopify retries.\n\nStock is updated per line; when a product drops below its threshold a **low-stock alert** is logged (and sent to Telegram when enabled).',
      height: 280, width: 440, color: 4
    }),
    node('Setup notes', 'n8n-nodes-base.stickyNote', 1, [-200, 360], {
      content: '### Inputs\n- **Shop webhook** accepts Shopify-format order and refund JSON (header `X-Shop-Token`). Point Shopify webhooks here when n8n is publicly reachable, or send test orders with `send-test-orders.sh`.\n- **Shopify trigger** (disabled): use instead when connected to a real Shopify store.\n- **Telegram** (disabled): add a bot credential and chat ID to get alerts on your phone.',
      height: 260, width: 440, color: 7
    }),
    node('Shop webhook', 'n8n-nodes-base.webhook', 2, [300, 0], {
      httpMethod: 'POST', path: 'shop-orders', authentication: 'headerAuth', responseMode: 'responseNode', options: {}
    }, { webhookId: '7c1e5a2b-4d3f-4e6a-8b9c-0d1e2f3a4b5c' }),
    node('Shopify trigger', 'n8n-nodes-base.shopifyTrigger', 1, [300, 200], {
      topic: 'orders/create', authentication: 'accessToken'
    }, { disabled: true, webhookId: randomUUID() }),
    node('Map to invoice', 'n8n-nodes-base.code', 2, [520, 100], { mode: 'runOnceForEachItem', jsCode: read('map-order.js') }),
    node('Save invoice', 'n8n-nodes-base.postgres', 2.5, [740, 100], {
      schema: { __rl: true, mode: 'name', value: 'demo' },
      table: { __rl: true, mode: 'name', value: 'shop_invoices' },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
      options: { skipOnConflict: true }
    }),
    node('Reply to shop', 'n8n-nodes-base.respondToWebhook', 1.1, [960, 0], {
      respondWith: 'json',
      responseBody: '={{ $json.doc_number ? { ok: true, doc_number: $json.doc_number, doc_type: $json.doc_type, total: $json.total_amount, needs_review: $json.needs_review, review_reasons: $json.review_reasons } : { ok: true, duplicate: true, note: "already booked, ignored" } }}',
      options: {}
    }),
    node('Split lines', 'n8n-nodes-base.code', 2, [1180, 100], { jsCode: splitLines }),
    node('Update stock', 'n8n-nodes-base.postgres', 2.5, [1400, 100], {
      operation: 'executeQuery',
      query: 'UPDATE demo.products SET stock = stock - $1::int WHERE sku = $2 RETURNING sku, title, stock, low_stock_threshold;',
      options: { queryReplacement: '={{ $json.qty }},{{ $json.sku }}' }
    }),
    node('Low stock?', 'n8n-nodes-base.if', 2.2, [1620, 100], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: randomUUID(), leftValue: '={{ $json.stock }}', rightValue: '={{ $json.low_stock_threshold }}', operator: { type: 'number', operation: 'lt' } }],
        combinator: 'and'
      },
      options: {}
    }),
    node('Build alert', 'n8n-nodes-base.code', 2, [1840, 0], { mode: 'runOnceForEachItem', jsCode: buildAlert }),
    node('Log alert', 'n8n-nodes-base.postgres', 2.5, [2060, 0], {
      schema: { __rl: true, mode: 'name', value: 'demo' },
      table: { __rl: true, mode: 'name', value: 'shop_alerts' },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
      options: {}
    }),
    node('Telegram alert', 'n8n-nodes-base.telegram', 1.2, [2280, 0], {
      chatId: '[your chat id]', text: '={{ "⚠️ " + $json.message }}', additionalFields: {}
    }, { disabled: true })
  ],
  connections: {
    'Shop webhook': main('Map to invoice'),
    'Shopify trigger': main('Map to invoice'),
    'Map to invoice': main('Save invoice'),
    'Save invoice': main('Reply to shop'),
    'Reply to shop': main('Split lines'),
    'Split lines': main('Update stock'),
    'Update stock': main('Low stock?'),
    'Low stock?': { main: [[{ node: 'Build alert', type: 'main', index: 0 }], []] },
    'Build alert': main('Log alert'),
    'Log alert': main('Telegram alert')
  },
  settings: { executionOrder: 'v1' }
};

// ---------- Workflow 2: daily sales summary ----------
n = 100;
const summarySql = `SELECT current_date::text AS day,
  count(*) FILTER (WHERE doc_type = 'invoice')::int AS orders,
  count(*) FILTER (WHERE doc_type = 'credit_note')::int AS refunds,
  coalesce(sum(total_amount), 0)::float AS revenue_incl_vat,
  coalesce(sum(net_amount), 0)::float AS revenue_excl_vat,
  coalesce(sum(vat_amount), 0)::float AS vat,
  count(*) FILTER (WHERE needs_review)::int AS needs_review,
  (SELECT count(*) FROM demo.shop_alerts WHERE created_at::date = current_date)::int AS low_stock_alerts
FROM demo.shop_invoices
WHERE created_at::date = current_date;`;

const formatSummary = `const s = $json;
const eur = v => '€' + Number(v).toFixed(2).replace('.', ',');
return { json: { ...s, message: [
  \`📊 Sales \${s.day}\`,
  \`Orders: \${s.orders} · Refunds: \${s.refunds}\`,
  \`Revenue: \${eur(s.revenue_incl_vat)} incl. VAT (\${eur(s.revenue_excl_vat)} excl., VAT \${eur(s.vat)})\`,
  \`Needs review: \${s.needs_review} · Low-stock alerts: \${s.low_stock_alerts}\`
].join('\\n') } };`;

const summary = {
  name: 'Webshop daily sales summary (demo)',
  nodes: [
    node('Every day 18:00', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'days', triggerAtHour: 18 }] } }),
    node('Summary on demand', 'n8n-nodes-base.webhook', 2, [0, 200], {
      httpMethod: 'GET', path: 'shop-summary', authentication: 'headerAuth', responseMode: 'lastNode', options: {}
    }, { webhookId: '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b' }),
    node('Totals today', 'n8n-nodes-base.postgres', 2.5, [240, 100], { operation: 'executeQuery', query: summarySql, options: {} }),
    node('Format message', 'n8n-nodes-base.code', 2, [480, 100], { mode: 'runOnceForEachItem', jsCode: formatSummary }),
    node('Telegram summary', 'n8n-nodes-base.telegram', 1.2, [720, 100], {
      chatId: '[your chat id]', text: '={{ $json.message }}', additionalFields: {}
    }, { disabled: true })
  ],
  connections: {
    'Every day 18:00': main('Totals today'),
    'Summary on demand': main('Totals today'),
    'Totals today': main('Format message'),
    'Format message': main('Telegram summary')
  },
  settings: { executionOrder: 'v1' }
};

writeFileSync(new URL('webshop-orders-to-accounting.json', here), JSON.stringify(orders, null, 2) + '\n');
writeFileSync(new URL('webshop-daily-summary.json', here), JSON.stringify(summary, null, 2) + '\n');
console.log('built 2 workflows');
