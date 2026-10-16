// Fuente del editor del documento (TipTap 3, MIT). Se empaqueta con
// `npm run editor` a renderer/vendor/editor.js: la ventana no carga nada
// de internet y la CSP (script-src 'self') lo permite.
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";

// Id estable del párrafo (doc_bloque.id). No se copia al partir un párrafo:
// el pedazo nuevo es un bloque nuevo.
const BloqueId = Extension.create({
  name: "bloqueId",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading", "table"],
      attributes: {
        bloque: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => el.getAttribute("data-bloque"),
          renderHTML: (a) => (a.bloque ? { "data-bloque": a.bloque } : {}),
        },
      },
    }];
  },
});

export const EXTENSIONES = () => [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, strike: false, horizontalRule: false, link: false }),
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
  TableKit.configure({ table: { resizable: false } }),
  BloqueId,
];

export function crearEditor(elemento, { contenido, alCambiar, alMover } = {}) {
  return new Editor({
    element: elemento,
    extensions: EXTENSIONES(),
    content: contenido,
    editorProps: { attributes: { class: "doc-editor-hoja", spellcheck: "true", lang: "es" } },
    onUpdate: () => alCambiar?.(),
    onSelectionUpdate: () => alMover?.(),
  });
}

// El bloque donde está el cursor: párrafo, subtítulo o tabla con id.
export function bloqueActual(editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.attrs?.bloque) return { id: n.attrs.bloque, texto: n.textContent };
    if (n.type.name === "table") return { id: n.attrs.bloque || null, texto: n.textContent };
  }
  return null;
}
