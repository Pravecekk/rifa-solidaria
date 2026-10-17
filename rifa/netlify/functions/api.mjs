import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const stores = () => ({
  reservas: getStore({ name: "reservas", consistency: "strong" }),
  confirmados: getStore({ name: "confirmados", consistency: "strong" }),
});

const valido = (n) => Number.isInteger(n) && n >= 0 && n <= 999;

async function claves(store) {
  const { blobs } = await store.list();
  return blobs.map((b) => Number(b.key));
}

export default async (req) => {
  const url = new URL(req.url);
  const accion = url.searchParams.get("accion");
  const { reservas, confirmados } = stores();

  // ---------- PÚBLICO: estado de la grilla ----------
  if (req.method === "GET" && !accion) {
    const [tomados, pagados] = await Promise.all([claves(reservas), claves(confirmados)]);
    return json({ tomados, pagados });
  }

  // ---------- PÚBLICO: "ya pagué" ----------
  if (req.method === "POST" && accion === "reservar") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Datos inválidos" }, 400); }
    const numero = Number(body.numero);
    const nombre = String(body.nombre || "").trim().slice(0, 80);
    const telefono = String(body.telefono || "").trim().slice(0, 30);
    if (!valido(numero)) return json({ error: "Número inválido" }, 400);
    if (nombre.length < 2) return json({ error: "Escribe tu nombre" }, 400);

    // onlyIfNew = atómico: si dos personas aprietan el mismo número a la vez, solo uno gana
    const res = await reservas.setJSON(
      String(numero),
      { numero, nombre, telefono, fecha: new Date().toISOString() },
      { onlyIfNew: true }
    );
    if (!res.modified) return json({ error: "Ese número ya lo tomó otra persona 😕" }, 409);
    return json({ ok: true });
  }

  // ---------- ADMIN (requiere clave) ----------
  const clave = req.headers.get("x-admin-key");
  if (!process.env.ADMIN_KEY || clave !== process.env.ADMIN_KEY) {
    return json({ error: "No autorizado" }, 401);
  }

  if (req.method === "GET" && accion === "admin") {
    const [tomados, pagados] = await Promise.all([claves(reservas), claves(confirmados)]);
    const set = new Set(pagados);
    const lista = await Promise.all(
      tomados.map(async (n) => ({ ...(await reservas.get(String(n), { type: "json" })), confirmado: set.has(n) }))
    );
    lista.sort((a, b) => a.numero - b.numero);
    return json({ lista });
  }

  if (req.method === "POST") {
    const { numero } = await req.json();
    const n = Number(numero);
    if (!valido(n)) return json({ error: "Número inválido" }, 400);

    if (accion === "confirmar") { await confirmados.set(String(n), "1"); return json({ ok: true }); }
    if (accion === "desconfirmar") { await confirmados.delete(String(n)); return json({ ok: true }); }
    if (accion === "liberar") {
      await Promise.all([reservas.delete(String(n)), confirmados.delete(String(n))]);
      return json({ ok: true });
    }
  }

  return json({ error: "Acción no válida" }, 400);
};

export const config = { path: "/api" };
