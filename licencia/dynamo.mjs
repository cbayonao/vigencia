import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export function tiendaDynamo({ tabla = process.env.TABLA_LICENCIAS, indicePendiente = "pendiente-index", indicePagada = "pagada-index" } = {}) {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    async porInstalacion(instalacion) {
      const out = await doc.send(new GetCommand({ TableName: tabla, Key: { instalacion } }));
      return out.Item || null;
    },
    async porPendiente(referencia) {
      return primero(doc, tabla, indicePendiente, "pendiente", referencia);
    },
    async porPagada(referencia) {
      return primero(doc, tabla, indicePagada, "referenciaPagada", referencia);
    },
    async guardar(item) {
      const limpio = { ...item };
      if (!limpio.pendiente) delete limpio.pendiente;
      if (!limpio.referenciaPagada) delete limpio.referenciaPagada;
      await doc.send(new PutCommand({ TableName: tabla, Item: limpio }));
    },
  };
}

async function primero(doc, tabla, indice, campo, referencia) {
  const out = await doc.send(new QueryCommand({
    TableName: tabla,
    IndexName: indice,
    KeyConditionExpression: "#c = :v",
    ExpressionAttributeNames: { "#c": campo },
    ExpressionAttributeValues: { ":v": referencia },
    Limit: 1,
  }));
  return out.Items?.[0] || null;
}

// Comentarios de la app: pocos al día, el Scan con filtro basta y no
// necesita índices. Se guardan pendientes (visible=false) y el equipo los
// aprueba en la página de administración.
export function tiendaComentarios({ tabla = process.env.TABLA_COMENTARIOS || "vigencia-comentarios" } = {}) {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  async function listar({ soloVisibles, limite = 50 } = {}) {
    const params = { TableName: tabla, Limit: Math.min(100, Math.max(1, limite)) };
    if (soloVisibles) {
      params.FilterExpression = "#v = :uno";
      params.ExpressionAttributeNames = { "#v": "visible" };
      params.ExpressionAttributeValues = { ":uno": true };
    }
    const out = await doc.send(new ScanCommand(params));
    return (out.Items || []).sort((a, b) => String(b.creado || "").localeCompare(String(a.creado || "")));
  }
  return {
    async guardar(item) {
      await doc.send(new PutCommand({ TableName: tabla, Item: item }));
    },
    async visibles(limite) {
      return listar({ soloVisibles: true, limite });
    },
    async todos(limite) {
      return listar({ soloVisibles: false, limite });
    },
    async cambiarVisible(id, visible) {
      await doc.send(new UpdateCommand({
        TableName: tabla,
        Key: { id: String(id || "") },
        UpdateExpression: "SET #v = :v",
        ExpressionAttributeNames: { "#v": "visible" },
        ExpressionAttributeValues: { ":v": Boolean(visible) },
      }));
    },
  };
}
