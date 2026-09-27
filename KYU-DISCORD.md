# KyuApp en el bot actual de HAXOLE

La integración está en `utils/kyuApp.js` y `utils/kyu-backend/`. Comparte el servidor HTTP y el puerto del bot; no inicia un segundo bot ni reemplaza los comandos de liga. Los comandos Kyu se registran y ejecutan en su servidor aunque falte configurar OAuth. `KYU_ENABLED=1` activa únicamente las rutas de login de la app; no es un requisito para usar `/instalaciónkyu`. No se ha desplegado desde esta carpeta.

El servidor KyuApp `1510011417712132117` está autorizado directamente en el código: el bot permanece allí aunque todavía no se configure OAuth ni `KYU_ENABLED`. También es el ID predeterminado si no se establece `KYU_GUILD_ID`. Esto no habilita funciones de liga ni permite entrar a la app sin Discord/rol. Desplegar este código y reiniciar el bot registra los siete comandos Kyu; no hace falta expulsarlo y volver a invitarlo si ya está en el servidor. Las tareas de vencimiento de planes se mantienen aunque el login esté desactivado.

## 1. Variables del servicio Railway que ya ejecuta este bot

Conservá las variables actuales (Supabase, TOKEN, CLIENT_ID, etc.). Agregá:

```dotenv
KYU_ENABLED=1
KYU_PUBLIC_URL=https://assdfghjkl-production-9b52.up.railway.app
KYU_GUILD_ID=1510011417712132117
KYU_CLIENT_SECRET=CLIENT_SECRET_DE_LA_MISMA_APLICACION_DEL_BOT
KYU_PLAYER_ROLE_ID=1553753550251622550
KYU_PRO_ROLE_ID=1553753551187091546
KYU_PRO_PLUS_ROLE_ID=1553753552080343162
```

Los dos IDs se copian en Discord activando Ajustes → Avanzado → Modo desarrollador, y haciendo clic derecho en el servidor / rol. Si no hay rol Kyu, omití `KYU_PLAYER_ROLE_ID` inicialmente y ejecutá `/instalaciónkyu` después de desplegar. El bot crea o reutiliza `kyu`, `pro` y `pro+`, y guarda sus IDs.

Para el servidor `1510011417712132117`, los tres IDs confirmados arriba ya son valores predeterminados en el código. No hace falta agregarlos como variables si no existen. Si ya configuraste otros IDs en Railway, corregilos o quitá esas variables: los valores explícitos tienen prioridad. El archivo de roles guardados ya no pisa esta configuración. Tener roles con el mismo nombre no alcanza: se verifica el ID exacto, y `/instalaciónkyu` rechaza nombres duplicados ambiguos.

`TOKEN` y `CLIENT_ID` del bot actual se reutilizan. `KYU_CLIENT_SECRET` sale de **OAuth2 → Client Secret de esa misma aplicación** en Discord Developer Portal. No es el Bot Token ni la Public Key. No publiques ninguno de los secretos en GitHub, en el chat ni dentro de KyuApp. No hace falta resetear el token existente.

Para conservar planes, amigos y roles creados tras reinicios/despliegues, montá un volumen persistente dedicado, por ejemplo en `/kyu-data`, y configurá `KYU_DATA_FILE=/kyu-data/state.json`. No montes encima del código del bot. Sin volumen, la ruta por defecto es `data/kyu-app.json` y el hosting podría descartarla. Las sesiones OAuth son en memoria: usá **una sola réplica** y los usuarios volverán a vincular después de un reinicio.

Opcionales: `KYU_STAFF_ROLE_ID` para tickets/voz; `KYU_PRO_ROLE_ID`, `KYU_PRO_PLUS_ROLE_ID` si ya existen; `KYU_STREAMER_ROLE_IDS` separados por comas. Todos los jugadores Kyu tienen las funciones Pro locales en esta beta, independientemente del plan.

## 2. Discord Developer Portal

Abrí la aplicación correspondiente al `CLIENT_ID` del bot actual.

- **OAuth2 → Redirects → Add Redirect**, pegá exactamente:
  `https://assdfghjkl-production-9b52.up.railway.app/auth/callback`
- **General Information → Interactions Endpoint URL: dejalo vacío.** Este bot recibe comandos por Gateway. Si pusiste `/interactions` siguiendo la guía del backend separado, quitá ese valor para esta integración. No pegues el callback en este campo.
- El bot debe estar invitado a tu servidor con `bot` y `applications.commands`. Conservá los intents que ya requiere el bot de liga.
- Para sus comandos Kyu necesita gestionar roles/canales, ver canales, enviar mensajes y leer historial; enviar mensajes en hilos si vas a vincular uno. Colocá el rol del bot **por encima de kyu/pro/pro+**. No hace falta conceder Administrador para Kyu.

Referencia oficial: [Gateway y webhooks son modalidades excluyentes](https://docs.discord.com/developers/interactions/overview), [OAuth2 y redirect](https://docs.discord.com/developers/topics/oauth2).

## 3. Publicar el código y comprobar

Desplegá los cambios de **este repositorio del bot**, manteniendo su comando de inicio `npm start`. Recomendado Node 22 o superior. No reemplaces el servicio por el ZIP del backend independiente de Kyu.

No ejecutes `kyuapp/server/register.cjs` ni `npm run register` del backend independiente contra esta aplicación: haría un registro completo que podría borrar comandos de liga. Este bot registra los comandos de liga y Kyu juntos al iniciar, únicamente en sus servidores correspondientes.

En el entorno donde configuraste las variables podés ejecutar `npm run kyu:check`: valida presencia de variables sin imprimir secretos, iniciar el bot ni cambiar Discord. `npm run test:kyu` ejecuta pruebas locales con Discord simulado.

Abrí `https://assdfghjkl-production-9b52.up.railway.app/kyu/health`:

- **404:** todavía no se publicó este código o se está usando otro servicio/ruta.
- **503:** Kyu no está activado (`KYU_ENABLED=1`).
- `{"ok":true,"configured":false}`: faltan credenciales, URL o ID del servidor.
- `{"ok":true,"configured":true}`: están presentes los datos mínimos; esto **no verifica** que los secretos sean correctos ni que exista el rol. La comprobación real ocurre al autorizar Discord.

## 4. Darte acceso y entrar

1. Ejecutá `/instalaciónkyu` como administrador del Discord si no configuraste un rol existente. Asignate el rol `kyu`: no se concede automáticamente a todo el mundo.
2. Tu `KyuApp-beta-0.2/kyuapp-access.json` ya apunta al dominio correcto. Su único contenido necesario es `{"accessUrl":"https://assdfghjkl-production-9b52.up.railway.app"}`. No agregues `/auth/callback` a ese archivo.
3. Reabrí KyuApp → **Vincular Discord** arriba a la derecha → autorizá con la cuenta que tiene el rol → volvé a KyuApp → **Jugar**.
4. Si aparece `redirect_uri` inválido, compará el redirect exacto con el de arriba. Si falta el rol, verificá servidor, cuenta e ID del rol. Si los comandos no aparecen, verificá `KYU_GUILD_ID`, la invitación del bot y que Interactions Endpoint URL esté vacío.

Comandos añadidos: `/instalaciónkyu`, `/plan usuario plan tiempo`, `/planremove usuario`, `/jugadores canal`, `/ticket`, `/ticketcerrar`, `/cv nombre`. El tiempo se escribe `12h`, `30d` o `4w`. `/ticket` necesita `KYU_STAFF_ROLE_ID` para abrir consultas privadas.

## Alcance y límites

Las pruebas locales cubren OAuth simulado, secreto de emparejamiento de un solo uso, cookie/state, acceso por rol, revocación y permisos de comandos. Falta autorizar una cuenta real tras desplegar. La lista `/jugadores` muestra presencia declarada de sesiones, no prueba que estén en un partido ni garantiza detectar clientes modificados. Ningún ejecutable local es imposible de crackear; los servicios de Kyu comprueban el rol en el servidor.

Este cambio no completa el motor DirectX12, RTSS ni otras funciones pendientes de jugabilidad. El objetivo es habilitar el inicio de sesión con el bot existente.
