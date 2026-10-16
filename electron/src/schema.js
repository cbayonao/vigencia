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
  {
    version: 5,
    nombre: "biblioteca del escrito",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pieza (
            id            INTEGER PRIMARY KEY,
            nombre        TEXT NOT NULL,
            tipo          TEXT NOT NULL CHECK (tipo IN ('plantilla', 'ejemplo', 'norma', 'estilo')),
            texto         TEXT NOT NULL,
            activa        INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
            creado_en     TEXT NOT NULL,
            actualizado_en TEXT NOT NULL
        );
      `);
      const insertar = db.prepare(`
        INSERT INTO pieza (nombre, tipo, texto, activa, creado_en, actualizado_en)
        VALUES (?, ?, ?, 1, ?, ?)
      `);
      const marca = "2026-10-12T00:00:00.000Z";
      const semillas = [
        [
          "Tono del memorial",
          "estilo",
          "Trato de usted. Tono formal y sobrio. No cites jurisprudencia. No abras secciones que el caso no necesite. Cierra con la firma de quien presenta.",
        ],
        [
          "Demanda, artículo 82 del CGP",
          "norma",
          "Si el escrito es una demanda, el artículo 82 del Código General del Proceso pide: juez, partes con identificación y domicilio, pretensiones, hechos numerados, pruebas, fundamentos de derecho, cuantía cuando define el trámite, y direcciones de notificación. Si falta un dato, márcalo como [Dato pendiente].",
        ],
        [
          "Tutela, artículo 14 del Decreto 2591 de 1991",
          "norma",
          "Si el escrito es una tutela, el artículo 86 de la Constitución y el artículo 14 del Decreto 2591 de 1991 piden: la acción u omisión, el derecho fundamental, la autoridad o persona accionada, el juramento de no haber presentado otra tutela por los mismos hechos, y el nombre y la ubicación de quien solicita. Si falta un dato, márcalo como [Dato pendiente].",
        ],
        [
          "Derecho de petición, artículo 16 de la Ley 1755 de 2015",
          "norma",
          "Si el escrito es un derecho de petición, el artículo 16 de la Ley 1755 de 2015 pide: la autoridad, el nombre y la dirección de quien solicita, el objeto, las razones y los documentos. Si falta un dato, márcalo como [Dato pendiente].",
        ],
      ];
      for (const [nombre, tipo, texto] of semillas) {
        insertar.run(nombre, tipo, texto, marca, marca);
      }
    },
  },
  {
    version: 6,
    nombre: "representado del abogado",
    up(db) {
      db.exec(`
        ALTER TABLE proceso_cliente ADD COLUMN representado TEXT;
        ALTER TABLE proceso_cliente ADD COLUMN representado_rol TEXT;
      `);
    },
  },
  {
    version: 7,
    nombre: "cedula y tarjeta del abogado",
    up(db) {
      db.exec(`
        ALTER TABLE cliente ADD COLUMN cedula TEXT;
        ALTER TABLE cliente ADD COLUMN tarjeta TEXT;
        ALTER TABLE proceso_cliente ADD COLUMN representado_cedula TEXT;
        ALTER TABLE proceso_cliente ADD COLUMN representado_direccion TEXT;
        ALTER TABLE proceso_cliente ADD COLUMN representado_telefono TEXT;
      `);
    },
  },
  {
    version: 8,
    nombre: "publicaciones procesales",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pp_departamento (
          codigo TEXT PRIMARY KEY,
          nombre TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pp_municipio (
          codigo TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          depto TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pp_despacho (
          codigo TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          depto TEXT NOT NULL,
          muni TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS pp_despacho_lugar ON pp_despacho(depto, muni);
        CREATE TABLE IF NOT EXISTS pp_carga (
          despacho TEXT PRIMARY KEY,
          total INTEGER NOT NULL DEFAULT 0,
          paginas INTEGER NOT NULL DEFAULT 0,
          avisos INTEGER NOT NULL DEFAULT 0,
          actualizada TEXT NOT NULL DEFAULT '',
          estado TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS pp_publicacion (
          id INTEGER PRIMARY KEY,
          despacho TEXT NOT NULL,
          article_id TEXT NOT NULL UNIQUE,
          titulo TEXT NOT NULL DEFAULT '',
          fecha TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          detalle_url TEXT NOT NULL DEFAULT '',
          tipo TEXT NOT NULL DEFAULT '',
          entidad TEXT NOT NULL DEFAULT '',
          especialidad TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS pp_pub_despacho ON pp_publicacion(despacho);
        CREATE TABLE IF NOT EXISTS pp_documento (
          id INTEGER PRIMARY KEY,
          publicacion INTEGER NOT NULL REFERENCES pp_publicacion(id) ON DELETE CASCADE,
          nombre TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          fecha TEXT NOT NULL DEFAULT '',
          origen TEXT NOT NULL DEFAULT '',
          UNIQUE(publicacion, url)
        );
      `);
    },
  },
  {
    version: 9,
    nombre: "casos spoa",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS spoa_caso (
          noticia TEXT PRIMARY KEY,
          caso_id TEXT NOT NULL DEFAULT '',
          despacho TEXT NOT NULL DEFAULT '',
          unidad TEXT NOT NULL DEFAULT '',
          seccional TEXT NOT NULL DEFAULT '',
          direccion TEXT NOT NULL DEFAULT '',
          telefono TEXT NOT NULL DEFAULT '',
          depto_unidad TEXT NOT NULL DEFAULT '',
          muni_unidad TEXT NOT NULL DEFAULT '',
          fecha_asignacion TEXT NOT NULL DEFAULT '',
          estado TEXT NOT NULL DEFAULT '',
          etapa TEXT NOT NULL DEFAULT '',
          ley TEXT NOT NULL DEFAULT '',
          correo TEXT NOT NULL DEFAULT '',
          depto_hecho TEXT NOT NULL DEFAULT '',
          muni_hecho TEXT NOT NULL DEFAULT '',
          fecha_hechos TEXT NOT NULL DEFAULT '',
          delitos TEXT NOT NULL DEFAULT '',
          reservado TEXT NOT NULL DEFAULT '',
          conexado TEXT NOT NULL DEFAULT '',
          actualizada TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS spoa_actuacion (
          id INTEGER PRIMARY KEY,
          noticia TEXT NOT NULL,
          fecha TEXT NOT NULL DEFAULT '',
          descripcion TEXT NOT NULL DEFAULT '',
          UNIQUE(noticia, fecha, descripcion)
        );
        CREATE INDEX IF NOT EXISTS spoa_act_noticia ON spoa_actuacion(noticia);
      `);
    },
  },
  {
    version: 10,
    nombre: "casos samai",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS samai_caso (
          guid TEXT PRIMARY KEY,
          radicado TEXT NOT NULL DEFAULT '',
          corporacion TEXT NOT NULL DEFAULT '',
          ponente TEXT NOT NULL DEFAULT '',
          despacho TEXT NOT NULL DEFAULT '',
          despacho_lindo TEXT NOT NULL DEFAULT '',
          titular TEXT NOT NULL DEFAULT '',
          clase TEXT NOT NULL DEFAULT '',
          fecha_ingreso TEXT NOT NULL DEFAULT '',
          vigente TEXT NOT NULL DEFAULT '',
          asunto TEXT NOT NULL DEFAULT '',
          demandante TEXT NOT NULL DEFAULT '',
          demandado TEXT NOT NULL DEFAULT '',
          url_detalle TEXT NOT NULL DEFAULT '',
          actualizada TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS samai_actuacion (
          id INTEGER PRIMARY KEY,
          guid TEXT NOT NULL,
          fecha_registro TEXT NOT NULL DEFAULT '',
          fecha TEXT NOT NULL DEFAULT '',
          actuacion TEXT NOT NULL DEFAULT '',
          anotacion TEXT NOT NULL DEFAULT '',
          estado TEXT NOT NULL DEFAULT '',
          anexos TEXT NOT NULL DEFAULT '',
          indice TEXT NOT NULL DEFAULT '',
          UNIQUE(guid, indice)
        );
        CREATE INDEX IF NOT EXISTS samai_act_guid ON samai_actuacion(guid);
      `);
    },
  },
];
