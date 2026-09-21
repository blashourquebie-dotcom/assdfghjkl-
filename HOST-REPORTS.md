# Avisos de creación de host

Los seis scripts vigentes envían `POST /api/officials/notify-host?guildId=...` al obtener el enlace de la sala. El backend busca coincidencias y envía un aviso separado de `Sala creada` al canal vinculado mediante `/vinvalidaciones` en esa liga. También envía una copia al canal general de PRUEBAS si está vinculado.

Ese aviso muestra sala, enlace, contraseña de entrada y Discords posibles: no muestra valores de IP/conn/auth ni versión o contexto del host. Si la sala está abierta indica «Sin contraseña»; si el script anterior no envía el dato indica «No informada». La clave sólo se revela en el canal privado vinculado (y la copia general privada si existe), nunca en el webhook detallado ni en respuestas públicas. Las claves de administrador y owner no se envían. Es una captura al crear la sala; no modifica avisos anteriores ni sigue cambios posteriores de contraseña.

Una coincidencia única se rotula como posible hoster; varias se enumeran sin elegir arbitrariamente a alguien. Para ver las coincidencias el canal debe ser privado. Para incluir la contraseña, desplegar el backend y usar una de las seis copias vigentes regeneradas.

El webhook detallado `OFFICIAL_HOST_WEBHOOK_URL` es opcional e independiente. No hace falta configurarlo para recibir el aviso resumido en `/vinvalidaciones`.

## Activación en Railway

1. Desplegar esta versión del backend.
2. Un administrador ejecuta `/vinvalidaciones` en el canal privado de la liga donde quiere recibir los avisos (si ya está vinculado, no hace falta repetirlo). El bot necesita poder ver el canal, enviar mensajes y adjuntar embeds. En PRUEBAS se puede vincular un canal general de la misma forma.
3. Opcionalmente agregar `OFFICIAL_HOST_WEBHOOK_URL` en las variables del servicio para conservar el aviso detallado. Ya está guardado en el `.env` local, ignorado por Git. El webhook debe pertenecer a la misma liga o a PRUEBAS/general, y el bot debe poder consultar su canal. Nunca copiar su clave a los scripts públicos.
4. Recargar Headless y pegar la copia vigente de `SCRIPTS/obfuscadas/CONECTADOS-WEB Y CON AUTOVALIDACION` antes de crear otra sala.

La URL entregada respondió correctamente a la consulta de metadatos y apunta a PRUEBAS/general. No se envió un aviso real durante las pruebas. El token local del bot respondió 401 al intentar consultar permisos: no se pudo verificar la privacidad del canal desde esta máquina. Esto no permite concluir cuál es el estado del token desplegado en Railway.

## Qué informa el webhook detallado opcional

- Liga, sala, enlace, versión y fecha.
- IP pública consultada desde la página del host; se etiqueta como declarada porque puede manipularse y no prueba identidad.
- Todas las cuentas Discord candidatas encontradas por IP en vinculaciones guardadas y entradas confirmadas de las ligas autorizadas. El embed muestra hasta cinco cuentas y avisa si hay más.
- También revisa conns guardadas que contengan una IP codificada en hexadecimal. No fabrica una conn del creador a partir de su IP: esas conns se muestran como registros anteriores.

No se usa la conn del owner como si fuese la del creador. Headless no proporciona conn/auth del creador sin jugador. Tampoco se otorgan permisos o autovalidaciones a partir de estas coincidencias. IP compartida y conn derivada no son pruebas independientes de identidad.

La búsqueda no tiene un endpoint público de resultados. El POST sólo responde éxito/error. Los datos y coincidencias del host aparecen únicamente en avisos separados de creación (resumen en el canal vinculado y detalle opcional en el webhook): no se incluyen en el informe Anti-DU ni se usan para puntuar al jugador.

## Límites y errores

El navegador espera hasta cuatro segundos a la consulta de IP, sin bloquear la sala, y realiza como máximo tres intentos para errores de red, 429 o 5xx. Un 404 indica normalmente que falta desplegar la ruta nueva. `HOST_VALIDATION_CHANNEL_NOT_CONFIGURED` indica que falta ejecutar `/vinvalidaciones` en la liga; `HOST_VALIDATION_CHANNEL_INVALID` indica un canal inválido o de otro servidor. Si falla un destino después de entregar otro, los reintentos omiten los ya entregados en el mismo proceso.

Comprobación de la URL de Railway informada el 18/09/2026: GET respondió 405 y POST con cuerpo vacío respondió 400 `INVALID_HOST_REPORT`. La ruta estaba publicada al comprobarla. Estas consultas no enviaron mensajes a Discord. El 404 aportado no se reprodujo; el resumen nuevo sí requiere desplegar este cambio del backend.

El backend limita tamaño de solicitudes y frecuencia, y evita envíos duplicados por liga/enlace durante 24 horas en el mismo proceso. No es una garantía de entrega exactamente una vez: reinicios o respuestas de Discord perdidas después de entregar el mensaje pueden causar duplicados. No se escriben tokens ni datos de red en los logs de errores.

Pruebas: `node --test tests/*.test.js`. Ninguna prueba envía mensajes reales a Discord.
