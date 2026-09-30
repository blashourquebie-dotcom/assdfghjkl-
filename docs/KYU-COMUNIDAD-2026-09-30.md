# Comunidad Kyu — cambios locales, no desplegados

## Comandos

- `/introduccion`: presentación de KyuApp y requisito de Discord + rol jugador.
- `/planes pro_ars:...`: la primera publicación exige confirmar el precio Pro. Se conserva para publicaciones posteriores. Los seis precios/cantidades son configurables. Valores restantes iniciales del TXT: Pro UYU 100, 1 boost; Pro+ ARS 5500, UYU 150, 2 boosts. La política comercial de actualizaciones se informa, pero su restricción técnica aún no está implementada.
- `/prolist [plan] [pagina]`: planes activos registrados por este bot; no inventa vencimientos para roles manuales.
- `/beta cantidad:... [rol]`: inscripción con cupo, botón y contador. Elegir un rol beta con permisos 0, distinto de jugador/Pro/Pro+/staff; si se omite, debe existir un único rol llamado beta. El bot debe tener Gestionar roles y estar por encima del rol beta.
- `/betaestado`: cantidad confirmada y pendiente.
- `/betacerrar`: desactiva la inscripción y conserva los roles otorgados.
- `/plan`, `/planremove` y vencimientos automáticos: sólo administran Pro/Pro+, nunca asignan ni retiran jugador Kyu, incluso para planes antiguos con `grantedPlayer`.
- `/ticket`: admite el banner original en el panel existente. `/ticketcerrar` ya existía y conserva el historial; no se afirma resuelto un error de creación de tickets sin el caso concreto.

Estos comandos administrativos requieren Administrar servidor. El botón beta responde en privado y valida servidor, canal y mensaje del panel. No se habilita acceso anónimo a la aplicación.

## Persistencia y fallos

Se conserva `KYU_DATA_FILE` con escritura temporal y renombrado. Para producción debe vivir en almacenamiento persistente; sin eso, un redeploy puede perder planes, sesiones y cupos. No se editaron datos reales ni variables del despliegue.

El cupo beta serializa operaciones en **un único proceso del bot**. Reserva el lugar en disco antes de asignar el rol; un fallo incierto mantiene la reserva y el usuario puede reintentar. Un rechazo confirmado libera el lugar. Si falla actualizar el contador, el siguiente tick reintenta sin volver a otorgar el rol. No ejecutar varias réplicas contra el mismo archivo: el esquema no implementa bloqueo distribuido.

## Banners

Ver `assets/banners/kyu/README.md`. Los PNG originales están pendientes de copiar desde los adjuntos; no se recrearon. El transporte usa archivos multipart y `attachment://` conforme a la [documentación de Discord](https://github.com/discord/discord-api-docs/blob/main/developers/reference.mdx). El ticket conserva Components V2 y añade una galería, sin mezclar embeds/content incompatibles.

## Activación pendiente

Subir estos cambios y los PNG al despliegue, mantener el archivo de datos en volumen persistente y reiniciar el bot para registrar los comandos. No se ejecutó el bot activo, no se publicaron mensajes ni se modificaron roles durante las pruebas.

Quedan pendientes `/updates`, `/update publish`, `/launcher-update`, `/instalar` multimarcas, rol automático ver, la revisión del error concreto de tickets y las pruebas en el servidor real.
