-- Medición del sitio · base D1 «biketrust-medicion»
--
-- UNA tabla para las dos cosas que hay que medir:
--   tipo='vista' → alguien abrió una página (con `ref` = la bici, si es una ficha)
--   tipo='clic'  → alguien apretó un CTA (con `cta` = cuál)
--
-- Lo que NO se guarda, a propósito: IP, cookie, user-agent, huella de navegador,
-- nombre, teléfono. `sesion` es un id aleatorio que vive en la pestaña y muere al
-- cerrarla (sessionStorage), así que no sigue a nadie entre visitas ni entre sitios.
-- Sin dato personal no hay tratamiento que declarar bajo la ley 21.719.

CREATE TABLE IF NOT EXISTS eventos (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,          -- ISO-8601 UTC, lo pone el servidor
  dia    TEXT NOT NULL,          -- YYYY-MM-DD en hora de Santiago (para agrupar sin parsear)
  tipo   TEXT NOT NULL,          -- 'vista' | 'clic'
  cta    TEXT,                   -- solo en clic: 'ficha' | 'encargo' | 'consigna' | 'general' | ...
  ref    TEXT,                   -- Inventario.Referencia de la bici, si la página es una ficha
  pagina TEXT NOT NULL,          -- pathname, sin query ni hash
  origen TEXT,                   -- host de procedencia ya reducido: 'instagram.com', 'google', ''
  disp   TEXT,                   -- 'movil' | 'escritorio'
  sesion TEXT NOT NULL           -- id efímero de pestaña (no es identificador de persona)
);

-- El tablero pregunta siempre por rango de fechas y por cta/ref.
CREATE INDEX IF NOT EXISTS ix_eventos_dia      ON eventos(dia);
CREATE INDEX IF NOT EXISTS ix_eventos_tipo_cta ON eventos(tipo, cta);
CREATE INDEX IF NOT EXISTS ix_eventos_ref      ON eventos(ref) WHERE ref IS NOT NULL;
