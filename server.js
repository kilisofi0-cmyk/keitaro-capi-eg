import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Твои настройки
const PIXEL_ID = "2127606651103755";
const ACCESS_TOKEN = "EAApZBHgE1EpIBQHhoqROHeHIze0Wx25PwRHOZAQUo9cTq3kWfVMAe5uasGGZBnusEcCYNeF2QLXwwYJakjZAjAqE5JFaRsNPxhZAWziGJFzfg3ZBAWwMFW36PIdrEyBTXBBcKjgL3HfksmHJamEHnOtNArTfkAjCSbfPFcuLLxcO21nZCfabWkViZCe67NFXKwZDZD";

app.get("/capi", async (req, res) => {
  const { event, subid, amount, fbclid, ua, ip, landing, test_event_code } = req.query;

  console.log("📩 Входящий постбек:", req.query);

  if (!subid) {
    return res.json({ status: "error", message: "Missing subid" });
  }

  // 1. ЛОГИКА ДОМЕНА (landing)
  // Если из Кейтаро пришла абракадабра со скобками или пусто, ставим основной домен
  let cleanDomain = "betterspin.online"; 
  if (landing && !landing.includes("{") && landing !== "") {
    cleanDomain = landing.replace(/^https?:\/\//, '').split('/')[0];
  }
  const event_url = `https://${cleanDomain}/`;

  // 2. ЛОГИКА CLICK ID (fbc)
  // Формируем fbc только если fbclid — это реальный ID (без скобок)
  let fbc = undefined;
  if (fbclid && !fbclid.includes("{") && fbclid !== "") {
    fbc = `fb.1.${Math.floor(Date.now() / 1000)}.${fbclid}`;
  }

  // 3. ОПРЕДЕЛЕНИЕ ТИПА СОБЫТИЯ
  const isPurchase = (event === "sale" || event === "lead");
  const event_name = isPurchase ? "Purchase" : "CompleteRegistration";

  const payload = {
    data: [
      {
        event_name: event_name,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_id: subid,
        event_source_url: event_url,
        
        user_data: {
          client_user_agent: ua || undefined,
          client_ip_address: ip || undefined,
          external_id: subid, // Твой subid из трекера
          fbc: fbc,
        },

        custom_data: isPurchase ? {
          currency: "USD",
          value: parseFloat(amount) || 0,
        } : {},
      },
    ],
  };

  if (test_event_code) {
    payload.test_event_code = test_event_code;
  }

  try {
    const fbURL = `https://graph.facebook.com/v17.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const response = await fetch(fbURL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });

    const result = await response.json();
    console.log(`📨 Ответ FB для ${subid}:`, result);
    return res.json({ status: "OK", fb: result });
  } catch (error) {
    console.error("❌ Ошибка отправки:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер CAPI запущен на порту ${PORT}`);
});
