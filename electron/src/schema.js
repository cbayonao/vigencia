export const BASE_SQL = `
CREATE TABLE IF NOT EXISTS ficha (
    id            INTEGER PRIMARY KEY,
    fila_csv      INTEGER NOT NULL UNIQUE,
    ciudad        TEXT,
    tipo_proceso  TEXT,
    demandante    TEXT,
    demandado     TEXT
);

CREATE TABLE IF NOT EXISTS ficha_juzgado (
    id        INTEGER PRIMARY KEY,
    ficha_id  INTEGER NOT NULL REFERENCES ficha(id),
    orden     INTEGER NOT NULL,
    nombre    TEXT,
    url       TEXT
);

CREATE TABLE IF NOT EXISTS radicado (
    numero              TEXT PRIMARY KEY,
    cantidad_registros  INTEGER,
    consultado_en       TEXT
);

CREATE TABLE IF NOT EXISTS ficha_radicado (
    ficha_id  INTEGER NOT NULL REFERENCES ficha(id),
    radicado  TEXT NOT NULL REFERENCES radicado(numero),
    orden     INTEGER NOT NULL,
    PRIMARY KEY (ficha_id, radicado)
);

CREATE TABLE IF NOT EXISTS proceso (
    id_proceso              INTEGER PRIMARY KEY,
    id_reg_proceso          INTEGER,
    radicado                TEXT NOT NULL REFERENCES radicado(numero),
    id_conexion             INTEGER,
    fecha_proceso           TEXT,
    fecha_ultima_actuacion  TEXT,
    despacho                TEXT,
    codigo_despacho         TEXT,
    departamento            TEXT,
    ponente                 TEXT,
    tipo_proceso            TEXT,
    clase_proceso           TEXT,
    subclase_proceso        TEXT,
    recurso                 TEXT,
    ubicacion               TEXT,
    contenido_radicacion    TEXT,
    es_privado              INTEGER NOT NULL DEFAULT 0,
    sujetos                 TEXT,
    ultima_actualizacion    TEXT,
    detalle_consultado_en   TEXT
);

CREATE TABLE IF NOT EXISTS parte (
    id          INTEGER PRIMARY KEY,
    id_proceso  INTEGER NOT NULL REFERENCES proceso(id_proceso),
    orden       INTEGER NOT NULL,
    rol         TEXT NOT NULL,
    rol_base    TEXT NOT NULL,
    nombre      TEXT NOT NULL,
    UNIQUE (id_proceso, orden)
);

CREATE TABLE IF NOT EXISTS sujeto (
    id              INTEGER PRIMARY KEY,
    id_proceso      INTEGER NOT NULL REFERENCES proceso(id_proceso),
    id_reg_sujeto   INTEGER NOT NULL,
    tipo_sujeto     TEXT,
    rol_base        TEXT,
    es_emplazado    INTEGER NOT NULL DEFAULT 0,
    identificacion  TEXT,
    nombre          TEXT,
    UNIQUE (id_proceso, id_reg_sujeto)
);

CREATE TABLE IF NOT EXISTS documento (
    id                INTEGER PRIMARY KEY,
    id_proceso        INTEGER NOT NULL REFERENCES proceso(id_proceso),
    clave             TEXT NOT NULL,
    id_reg_documento  INTEGER,
    nombre            TEXT,
    descripcion       TEXT,
    fecha_carga       TEXT,
    tipo              TEXT,
    enlace            TEXT,
    extra             TEXT,
    UNIQUE (id_proceso, clave)
);

CREATE TABLE IF NOT EXISTS actuacion (
    id_reg_actuacion  INTEGER PRIMARY KEY,
    id_proceso        INTEGER NOT NULL REFERENCES proceso(id_proceso),
    radicado          TEXT,
    consecutivo       INTEGER,
    fecha_actuacion   TEXT,
    actuacion         TEXT,
    anotacion         TEXT,
    fecha_inicial     TEXT,
    fecha_final       TEXT,
    fecha_registro    TEXT,
    cod_regla         TEXT,
    con_documentos    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS aviso (
    id          INTEGER PRIMARY KEY,
    creado_en   TEXT NOT NULL,
    id_proceso  INTEGER,
    radicado    TEXT,
    tipo        TEXT NOT NULL,
    resumen     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proceso_radicado ON proceso(radicado);
CREATE INDEX IF NOT EXISTS idx_parte_proceso ON parte(id_proceso);
CREATE INDEX IF NOT EXISTS idx_ficha_radicado_numero ON ficha_radicado(radicado);
CREATE INDEX IF NOT EXISTS idx_sujeto_proceso ON sujeto(id_proceso);
CREATE INDEX IF NOT EXISTS idx_documento_proceso ON documento(id_proceso);
CREATE INDEX IF NOT EXISTS idx_actuacion_proceso ON actuacion(id_proceso);
CREATE INDEX IF NOT EXISTS idx_actuacion_fecha ON actuacion(fecha_actuacion);
CREATE INDEX IF NOT EXISTS idx_aviso_creado ON aviso(creado_en);

DROP VIEW IF EXISTS caso;
CREATE VIEW caso AS
SELECT
    p.id_proceso,
    p.radicado,
    p.despacho,
    p.departamento,
    p.ponente,
    p.tipo_proceso,
    p.clase_proceso,
    p.subclase_proceso,
    p.recurso,
    p.ubicacion,
    p.fecha_proceso,
    p.fecha_ultima_actuacion,
    p.contenido_radicacion,
    p.es_privado,
    f.ciudad,
    f.tipo_proceso AS tipo_csv,
    f.demandante AS demandante_csv,
    f.demandado AS demandado_csv,
    f.fila_csv
FROM proceso p
LEFT JOIN ficha_radicado fr ON fr.radicado = p.radicado
LEFT JOIN ficha f ON f.id = fr.ficha_id;
`;

export const COLUMNAS_PROCESO = [
  "sujetos_consultado_en",
  "documentos_consultado_en",
  "actuaciones_consultado_en",
];

export const MIGRACIONES = [
  {
    version: 1,
    nombre: "clientes",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cliente (
            id            INTEGER PRIMARY KEY,
            nombre        TEXT NOT NULL,
            apellidos     TEXT,
            telefonos     TEXT,
            direccion     TEXT,
            email         TEXT,
            creado_en     TEXT NOT NULL,
            actualizado_en TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS proceso_cliente (
            id_proceso   INTEGER PRIMARY KEY REFERENCES proceso(id_proceso) ON DELETE CASCADE,
            cliente_id   INTEGER NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
            asignado_en  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_proceso_cliente_cliente ON proceso_cliente(cliente_id);
      `);
    },
  },
  {
    version: 2,
    nombre: "pausa actualizar",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pausa_boton (
            clave TEXT PRIMARY KEY,
            hasta TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 3,
    nombre: "informe de la revision",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS informe_revision (
            clave     TEXT PRIMARY KEY,
            creado_en TEXT NOT NULL,
            total     INTEGER NOT NULL,
            exitosos  INTEGER NOT NULL,
            fallidos  INTEGER NOT NULL,
            detalle   TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    nombre: "revision automatica",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ajuste (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS revision (
            id         INTEGER PRIMARY KEY,
            origen     TEXT NOT NULL,
            turno      TEXT,
            inicio     TEXT NOT NULL,
            fin        TEXT,
            estado     TEXT NOT NULL,
            revisados  INTEGER,
            cambiados  INTEGER,
            cambios    INTEGER,
            errores    INTEGER,
            error      TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_revision_inicio ON revision(inicio);

        INSERT OR IGNORE INTO ajuste (clave, valor) VALUES ('horarios_revision', '["07:00","13:00"]');
      `);
    },
  },
];
