import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
const app = express();
const PORT = process.env.PORT || 10000;
const PIXEL_ID = process.env.PIXEL_ID || "2414078082422904";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "EAApZBHgE1EpIBRiR86JIUvzbZBaMzMgm4pYx07dOKkxxHS1e3QZBtcbjVC9ggFW6ZBrX5GiYGtCRZBoTQSa6dWXmlwBfvZBjyTyOnMBPSFbnHlKx9MF03JH3IfKKHqj91dZBug1p55PSmmLevs8HYQgTM7TtZAk1oWCXgjRPn0LrM4J4KZAQ9Rfhy7UnKThd96AZDZD";
const API_VERSION = "v21.0";

const hash = (value) =>
  value ? crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex") : undefined;
const isReal = (val) => val && !val.includes("{") && val.trim() !== "";

// Разбирает conversion_time из Кейтаро.
// Понимает и unix-timestamp (число секунд), и строку-дату "2026-06-23 01:12:17".
// Возвращает время в секундах или null, если разобрать не удалось.
function parseConversionTime(raw) {
  if (!isReal(raw)) return null;
  const s = String(raw).trim();

  // Вариант 1: чистое число (unix timestamp)
  if (/^\d+$/.test(s)) {
    let num = parseInt(s, 10);
    // если это миллисекунды (13 знаков) - переводим в секунды
    if (s.length >= 13) num = Math.floor(num / 1000);
    return num;
  }

  // Вариант 2: строка-дата. Кейтаро обычно отдаёт в UTC.
  // Заменяем пробел на 'T' и добавляем Z, чтобы трактовать как UTC.
  let iso = s.replace(" ", "T");
  if (!/[zZ]|[+\-]\d\d:?\d\d$/.test(iso)) {
    iso += "Z";
  }
  const ms = Date.parse(iso);
  if (!isNaN(ms)) return Math.floor(ms / 1000);

  return null;
}

app.get("/capi", async (req, res) => {
  const { event, subid, amount, fbclid, fbp, ua, ip, landing, conversion_time, test_event_code } = req.query;
  console.log("📩 Входящий постбек:", req.query);

  if (!subid) {
    return res.status(400).json({ status: "error", message: "Missing subid" });
  }

  const now = Math.floor(Date.now() / 1000);

  // --- Реальное время конверсии ---
  // Берём conversion_time из ПП. Если его нет/кривой - откатываемся на now.
  let event_time = parseConversionTime(conversion_time);
  if (event_time === null) {
    event_time = now;
    console.log(`⚠️ conversion_time не распознан ('${conversion_time}'), ставлю текущее время`);
  }

  // Защита от "будущего": если время конверсии оказалось больше текущего
  // (рассинхрон часов и т.п.) - подрезаем до now.
  if (event_time > now + 60) {
    console.log(`⚠️ conversion_time в будущем, подрезаю до now`);
    event_time = now;
  }

  // --- Отсечка слишком старых конверсий ---
  // FB не принимает события старше 7 дней. Такие не шлём - они только
  // портят качество данных и всё равно будут отвергнуты.
  const ageDays = (now - event_time) / 86400;
  if (ageDays > 7) {
    console.log(`⏭️ SKIP ${subid}: конверсия старше 7 дней (${ageDays.toFixed(1)} дн), FB не примет`);
    return res.json({ status: "skipped_old", age_days: Number(ageDays.toFixed(1)) });
  }

  let cleanDomain = "orbitflow.lol";
  if (isReal(landing)) {
    cleanDomain = landing.replace(/^https?:\/\//, "").split("/")[0];
  }
  const event_source_url = `https://${cleanDomain}/`;

  // --- fbc с правильным временем ---
  // Внутри fbc timestamp должен соответствовать времени клика/конверсии,
  // а не моменту прихода постбека. Используем event_time.
  const fbc = isReal(fbclid)
    ? `fb.1.${event_time}.${fbclid}`
    : undefined;

  let event_name;
  if (event === "sale") {
    event_name = "Purchase";
  } else {
    event_name = "CompleteRegistration";
  }
  const isPurchase = event_name === "Purchase";
  const event_id = `${subid}_${event_name}`;

  const user_data = {
    client_user_agent: ua || undefined,
    client_ip_address: ip || undefined,
    external_id: hash(subid),
    fbc: fbc,
    fbp: isReal(fbp) ? fbp : undefined,
  };
  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);

  const eventData = {
    event_name,
    event_time,
    action_source: "website",
    event_id,
    event_source_url,
    user_data,
    custom_data: isPurchase
      ? { currency: "USD", value: parseFloat(amount) || 0 }
      : { content_name: "registration" },
  };

  const payload = { data: [eventData] };
  if (isReal(test_event_code)) {
    payload.test_event_code = test_event_code;
  }

  try {
    const fbURL = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const response = await fetch(fbURL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
    const result = await response.json();

    if (result.error) {
      console.error(`❌ FB error для ${subid}:`, result.error);
      return res.status(400).json({ status: "fb_error", fb: result });
    }

    console.log(`✅ ${event_name} для ${subid} time=${event_time} (${ageDays.toFixed(2)}дн): events_received=${result.events_received}`);
    return res.json({ status: "OK", event: event_name, event_time, fb: result });
  } catch (error) {
    console.error("❌ Ошибка отправки:", error.message);
    return res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/", (req, res) => res.json({ status: "alive" }));

app.listen(PORT, () => console.log(`🚀 CAPI сервер на порту ${PORT}`));
