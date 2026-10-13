# Vigencia

El plan cuesta $599.900 por un año. El año empieza cuando el pago queda confirmado. Hasta entonces, y otra vez cuando el año se cumple, la aplicación solo muestra la página de pago. Los expedientes siguen en el computador.

Hay dos formas de abrir una máquina: pagando con Wompi, o con una llave hecha a mano. La llave dura 10 años y solo abre la máquina para la que se creó.

## Activar con Wompi

Este es el camino normal.

1. Abre Vigencia. Aparece **Iniciar el plan**. Si el año ya se cumplió, el botón dice **Pagar el otro año**.
2. Pulsa ese botón. Se abre el pago de Wompi.
3. Paga $599.900.
4. Vuelve a Vigencia y pulsa **Ya pagué**.

Si Wompi ya confirmó el cobro, entra la lista. Cerrar la ventana de Wompi sin pagar deja el programa en la página de pago.

## Dónde está el archivo de cada máquina

Cada instalación tiene su propio `licencia.json`, al lado de la base. No lo muevas y no lo borres: si al abrir Vigencia ese archivo no está, el programa crea otro, con otro identificador, y una llave anterior deja de servir. El aviso es «Ese código no abre esta instalación.»

| Cómo está instalada | Dónde queda el archivo |
| --- | --- |
| Linux, programa instalado | `~/.config/Vigencia/licencia.json` |
| Mac, programa instalado | `~/Library/Application Support/Vigencia/licencia.json` |
| Windows, programa instalado | `%APPDATA%\Vigencia\licencia.json` |
| Desarrollo, `cd electron && npm start` | `licencia.json` en la raíz de este repositorio |

El programa instalado y el de desarrollo son dos instalaciones distintas. Una llave de una no abre la otra.

## Activar una máquina a mano

Hay dos papeles, no los mezcles:

- **Máquina A = la firma.** Es este computador Linux con el repositorio. Aquí vive `licencia/claves/licencia-privada.pem`: no está en git, no se sube a ningún lado y **nunca se copia a otra máquina**. Todo instalador armado desde este repositorio solo acepta llaves firmadas con esa privada.
- **Máquina B = la del cliente.** El Windows donde instalaste Vigencia. Aquí **no se generan llaves ni se clona el repo para firmar**: cualquier llave creada en B la ignora la aplicación y da «Ese código no abre esta instalación.»

Pasos (la llave dura 10 años y solo abre la máquina para la que se creó):

1. En **B**, abre Vigencia y déjala en **Iniciar el plan**. Así nace su `licencia.json` con su identificador.
2. En **B**, **copia** ese archivo a un USB o correo (no lo muevas: si falta, la app crea otro identificador y la llave no coincide). En Windows instalado está en `%APPDATA%\Vigencia\licencia.json`.
3. En **A**, firma la copia desde la raíz del repositorio (no dentro de `electron`). El comando imprime una línea de confirmación y, debajo, la llave larga:
   ```bash
   node licencia/emitir.mjs /tmp/vigencia-licencia.json
   ```
4. En **B**, pega solo la línea larga en **Código de activación** y pulsa **Activar**.

Atajo alternativo para el paso 3 y 4: el comando también deja la llave ya escrita dentro de la copia que firmaste. Puedes devolver ese archivo a **B** (sobrescribiendo el original con Vigencia cerrada) y abrir: entra directo sin pegar nada.

### Si la máquina que activas es esta misma (A)

Solo cuando el programa y la firma están en el mismo computador se firma en su sitio. Desde la raíz del repositorio:

```bash
# Linux instalado / desarrollo: ajusta la ruta al archivo de esa instalación
node licencia/emitir.mjs ~/.config/Vigencia/licencia.json
node licencia/emitir.mjs licencia.json
```

```powershell
# Windows instalado
node licencia/emitir.mjs "$env:APPDATA\Vigencia\licencia.json"
```

Ese comando activa esa instalación. No activa el programa instalado en otro computador.

Para volver a ver la página de pago, vacía `token` y `visto` en el `licencia.json` de esa máquina, cierra con **Salir** y ábrela otra vez.

## Actualizar la aplicación

Vigencia avisa sola cuando hay versión nueva: revisa al arrancar y muestra el diálogo con la versión instalada y la disponible. También está en Menú ▸ **Buscar actualizaciones**. El botón **Descargar** baja el instalador y lo abre (en Linux muestra la carpeta para abrirlo a mano). **Omitir esta versión** silencia solo esa versión. Actualizar no toca los expedientes ni la licencia: siguen donde estaban.

En Mac sin firma de Apple, la primera vez macOS puede decir que la app «está dañada»: es el bloqueo por falta de firma, no un daño real. Se abre con clic derecho ▸ Abrir, o una vez con `xattr -cr /Applications/Vigencia.app` en la terminal.

## Si el motor nativo no arranca

Los modelos GGUF necesitan el motor nativo; el modelo Sencillo no. En Menú ▸ **Modelos de IA**, el botón **Instalar motor** lo descarga en ese computador. Si aun así dice que el motor no está, pulse **Diagnosticar**: revisa paso a paso (plataforma, binario descargado, empaquetado, copia e importación) y el botón **Copiar detalle** deja el resultado listo para enviarlo al soporte. Al fallar, la aplicación repara sola su copia una vez antes de avisar.

## Publicar una versión nueva (desde este repositorio)

1. Suba `version` en `electron/package.json` (y `VERSION` en `landing/src/data.ts` si cambió lo visible).
2. `git push origin main`: se validan tests y Terraform, y se arman los instaladores de Windows, Linux y Mac como artefactos.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`: arma de nuevo, crea el release de GitHub y espeja los instaladores al CDN con nombres estables (`Vigencia-Setup.exe`, `Vigencia.AppImage`, `Vigencia.deb`, `Vigencia.dmg`), más `version.json` para el aviso en la app. La tarjeta de Mac del landing se activa sola cuando el release trae el `.dmg`.
