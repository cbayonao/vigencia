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

La firma está en este repositorio (`licencia/claves/licencia-privada.pem`). El comando se corre aquí, en la raíz del repositorio, no dentro de la carpeta `electron`.

1. Abre Vigencia en la máquina que quieres activar y déjala en **Iniciar el plan**. Así nace su `licencia.json`.
2. Copia ese archivo. No lo muevas. Si lo mueves, la aplicación crea otro y la llave no coincide.
3. En la raíz de este repositorio firma la copia. El comando imprime dos líneas: la fecha y, debajo, la llave.
4. En esa misma ventana, pega solo la línea larga en **Código de activación** y pulsa **Activar**. No pegues la frase de la fecha.

### Linux

```bash
cp ~/.config/Vigencia/licencia.json /tmp/vigencia-licencia.json
node licencia/emitir.mjs /tmp/vigencia-licencia.json
```

### Mac

```bash
cp "$HOME/Library/Application Support/Vigencia/licencia.json" /tmp/vigencia-licencia.json
node licencia/emitir.mjs /tmp/vigencia-licencia.json
```

### Windows (PowerShell)

```powershell
Copy-Item "$env:APPDATA\Vigencia\licencia.json" "$env:TEMP\vigencia-licencia.json"
node licencia/emitir.mjs "$env:TEMP\vigencia-licencia.json"
```

### Este repositorio, con `npm start`

El archivo ya está en la raíz. Desde la raíz:

```bash
node licencia/emitir.mjs licencia.json
```

Si el terminal está dentro de `electron`:

```bash
node ../licencia/emitir.mjs ../licencia.json
```

Ese comando activa el desarrollo. No activa el programa instalado.

### Si la aplicación está cerrada

Puedes firmar el archivo en su sitio y después abrir Vigencia. No hace falta pegar la llave.

Linux:

```bash
node licencia/emitir.mjs ~/.config/Vigencia/licencia.json
```

Mac:

```bash
node licencia/emitir.mjs "$HOME/Library/Application Support/Vigencia/licencia.json"
```

Windows (PowerShell):

```powershell
node licencia/emitir.mjs "$env:APPDATA\Vigencia\licencia.json"
```

Para volver a ver la página de pago, vacía `token` y `visto` en el `licencia.json` de esa máquina, cierra con **Salir** y ábrela otra vez.
