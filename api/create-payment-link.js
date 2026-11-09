// Vercel serverless function: creates a Square-hosted checkout link.
// Secrets live in Vercel → Settings → Environment Variables (never in index.html):
//   SQUARE_ACCESS_TOKEN  – from developer.squareup.com (Sandbox token first, then Production)
//   SQUARE_LOCATION_ID   – the location the money goes to
//   SQUARE_ENV           – "sandbox" while testing, "production" when live
const PRICE_PER_DOZEN_CENTS = 2800;
const DELIVERY_FEE_CENTS = 600;
const SITE_URL = "https://www.jadasmochidonuts.com";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const isProd = process.env.SQUARE_ENV === "production";
  if (!token || !locationId) return res.status(500).json({ error: "Square is not configured yet" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { orderId, dozens, delivery, email, summary } = body || {};

  // Prices are set here on the server, so nobody can change them from the browser.
  const qty = parseInt(dozens, 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) return res.status(400).json({ error: "Invalid order" });
  const ref = String(orderId || Date.now()).replace(/[^0-9A-Za-z-]/g, "").slice(0, 40);

  const lineItems = [{
    name: "Mochi Donuts (1 dozen)",
    quantity: String(qty),
    base_price_money: { amount: PRICE_PER_DOZEN_CENTS, currency: "USD" },
    note: String(summary || "").slice(0, 500),
  }];
  if (delivery) {
    lineItems.push({ name: "Local delivery", quantity: "1", base_price_money: { amount: DELIVERY_FEE_CENTS, currency: "USD" } });
  }

  const payload = {
    idempotency_key: `${ref}-${Math.random().toString(36).slice(2, 10)}`,
    order: { location_id: locationId, reference_id: ref, line_items: lineItems },
    checkout_options: {
      redirect_url: `${SITE_URL}/?paid=1&order=${ref}`,
      accepted_payment_methods: { apple_pay: true, google_pay: true },
    },
  };
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) payload.pre_populated_data = { buyer_email: email };

  try {
    const r = await fetch(`https://connect.${isProd ? "squareup" : "squareupsandbox"}.com/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: { "Square-Version": "2024-10-17", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok || !data.payment_link) {
      console.error("Square error:", JSON.stringify(data.errors || data));
      return res.status(502).json({ error: "Could not start card checkout" });
    }
    return res.status(200).json({ url: data.payment_link.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not reach Square" });
  }
};
