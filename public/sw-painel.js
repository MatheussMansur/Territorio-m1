// O service worker do painel (escopo /admin/, história 6.11). Guarda uma coisa só no aparelho: a
// foto da noite (reservas, fila de espera, salão e mesas abertas, telefones mascarados e sem
// dados de saúde), mandada pela página no máximo uma vez por minuto, no IndexedDB. Nunca guarda
// os arquivos do app: toda carga vai à rede, então o painel recarregado sempre abre a versão mais nova.
// A foto de outra noite é trocada pela seguinte. Instalado ou não, o painel funciona
// do mesmo jeito.
const DB = "territorio-painel";
const STORE = "retrato";
const KEY = "noite";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // nada de versão antiga fica: nenhum cache
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function openDb(version) {
  return new Promise((resolve, reject) => {
    const request = version ? indexedDB.open(DB, version) : indexedDB.open(DB);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function open() {
  const db = await openDb();
  if (db.objectStoreNames.contains(STORE)) return db;
  const next = db.version + 1;
  db.close();
  return openDb(next);
}

async function keep(picture) {
  if (!picture || typeof picture.date !== "string") return;
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(picture, KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "retrato") event.waitUntil(keep(event.data.picture));
});
