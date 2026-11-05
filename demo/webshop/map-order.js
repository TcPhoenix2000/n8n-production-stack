// Shopify order or refund webhook -> invoice / credit note record.
// Runs in an n8n Code node ("Run once for each item"). Output keys match demo.shop_invoices.
// Shopify sends EU prices including VAT (taxes_included = true); net = gross - tax.

const body = $json.body ?? $json;
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const isRefund = Array.isArray(body.refund_line_items);

const lineFrom = (li, qty, grossOverride, taxOverride) => {
  const taxLines = li.tax_lines || [];
  const rate = taxLines.length ? r2(taxLines.reduce((s, t) => s + Number(t.rate || 0), 0) * 100) : 0;
  const gross = grossOverride ?? r2(Number(li.price) * qty - Number(li.total_discount || 0));
  const vat = taxOverride ?? r2(taxLines.reduce((s, t) => s + Number(t.price || 0), 0));
  return { sku: li.sku || null, title: li.title || li.name, qty, unit_price_incl_vat: r2(li.price), vat_rate: rate, net: r2(gross - vat), vat, gross };
};

let lines = [];
let reportedTotal = null;
let reportedTax = null;

if (isRefund) {
  // refunds/create payload
  lines = body.refund_line_items.map(rli => {
    const gross = r2(Number(rli.subtotal || 0) + Number(rli.total_tax || 0));
    return lineFrom(rli.line_item || {}, rli.quantity, gross, r2(rli.total_tax));
  });
  const refunded = (body.transactions || []).filter(t => (t.kind || 'refund') === 'refund');
  reportedTotal = refunded.length ? r2(refunded.reduce((s, t) => s + Number(t.amount || 0), 0)) : null;
} else {
  // orders/create payload
  lines = (body.line_items || []).map(li => lineFrom(li, li.quantity));
  for (const sl of body.shipping_lines || []) {
    lines.push(lineFrom({ ...sl, sku: null, title: `Verzending: ${sl.title}` }, 1));
  }
  reportedTotal = body.total_price != null ? r2(body.total_price) : null;
  reportedTax = body.total_tax != null ? r2(body.total_tax) : null;
}

const net = r2(lines.reduce((s, l) => s + l.net, 0));
const vat = r2(lines.reduce((s, l) => s + l.vat, 0));
const total = r2(net + vat);

// VAT per rate, as needed on a Belgian invoice
const breakdown = {};
for (const l of lines) {
  const k = `${l.vat_rate}%`;
  breakdown[k] = breakdown[k] || { net: 0, vat: 0 };
  breakdown[k].net = r2(breakdown[k].net + l.net);
  breakdown[k].vat = r2(breakdown[k].vat + l.vat);
}

const reasons = [];
if (!lines.length) reasons.push('no lines');
if (reportedTotal !== null && Math.abs(reportedTotal - total) > 0.02) reasons.push(`line total ${total.toFixed(2)} differs from shop total ${reportedTotal.toFixed(2)}`);
if (reportedTax !== null && Math.abs(reportedTax - vat) > 0.02) reasons.push(`line VAT ${vat.toFixed(2)} differs from shop VAT ${reportedTax.toFixed(2)}`);
for (const l of lines) {
  if (![0, 6, 12, 21].includes(l.vat_rate)) reasons.push(`unusual Belgian VAT rate ${l.vat_rate}% on "${l.title}"`);
}

const order = isRefund ? (body.order || {}) : body;
const customer = order.customer || {};
const sign = isRefund ? -1 : 1;

return {
  json: {
    doc_type: isRefund ? 'credit_note' : 'invoice',
    shop: body.shop_domain || order.shop_domain || 'kustkoffie-demo.myshopify.com',
    shop_order_id: String(isRefund ? body.order_id : body.id),
    shop_order_name: order.name || null,
    shop_refund_id: isRefund ? String(body.id) : null,
    order_date: body.created_at || null,
    customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null,
    customer_email: customer.email || order.email || null,
    country: (order.billing_address || {}).country_code || null,
    currency: (body.currency || order.currency || 'EUR').toUpperCase(),
    net_amount: sign * net,
    vat_amount: sign * vat,
    total_amount: sign * total,
    vat_breakdown: JSON.stringify(Object.fromEntries(
      Object.entries(breakdown).map(([rate, v]) => [rate, { net: sign * v.net, vat: sign * v.vat }])
    )),
    lines: JSON.stringify(lines),
    needs_review: reasons.length > 0,
    review_reasons: reasons.length ? reasons.join('; ') : null
  }
};
