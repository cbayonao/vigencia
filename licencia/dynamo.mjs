import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

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
