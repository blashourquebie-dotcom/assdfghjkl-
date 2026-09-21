# Activación de esta actualización

1. Publicar el proyecto completo, incluidos los archivos nuevos de commands/, handlers/ y utils/.
   No publicar únicamente index.js: ahora depende de handlers/reportApprovalHandler.js.
2. En el SQL Editor del proyecto Supabase del bot, ejecutar en este orden:
   - supabase/migrations/202609090001_player_valuation.sql
   - supabase/migrations/202609090002_atomic_reports.sql
   La primera corrige el error confirmado de columna jugadores.valuacion inexistente.
   La segunda permite guardar resultado y estadísticas juntos; sin ella la aprobación queda pendiente.
3. Reiniciar el bot para registrar /configurar y /vincularinformesaprobaciones.
4. Ejecutar /vinvalidaciones en el canal de revisión de validaciones.
5. Ejecutar /vincularinformesaprobaciones en el canal de moderación de informes.
6. Ejecutar /vincularinformes modalidad: torneo: en cada canal/hilo de recepción.
   Aprobar y rechazar está limitado a administradores. La aprobación conserva una copia del texto recibido.

## Servidores

Se separan clubes, fichajes, configuración, mercados y aprobaciones por guild.
Los rankings y valuaciones de Supabase siguen siendo compartidos.
Para datos antiguos sin servidor explícito, definir LEGACY_GUILD_ID con el ID del
servidor original si hay más de un servidor posible. Se conservan los documentos
antiguos; no se asignan automáticamente a un servidor nuevo.
Los scripts que envíen validaciones por API deben incluir guildId cuando el bot
está en varios servidores.

## Informes

Se aceptan marcadores con guion o x, etiquetas g/a/v, bloques posicionales
con separadores explícitos, nombres vinculados, menciones y DF.
Para DF se deben identificar ambos clubes. Si falta el rival, corregir y reenviar.
Los nombres sin vínculo permanecen como texto: no se inventa una cuenta de Discord.
Los tiempos de valla deben ser MM:SS, MM.SS o segundos; "todo el partido"
sin duración genera una advertencia y no inventa minutos.
Los alias entre paréntesis no se convierten automáticamente en otra identidad.
Si hay varios partidos posibles entre dos clubes, indicar fecha en el informe.
Revisar siempre la previsualización y las advertencias antes de aprobar.

## Anti-DU

Se registra después de confirmar la validación, por servidor.
Los valores técnicos se guardan en el historial Anti-DU como HMAC, no se publican.
El indicador usa el mayor peso aplicable de las reglas (50/75/110/125/150),
limitando la visualización al 100%. No es una probabilidad estadística.
Se comparan coincidencias de IP/conn/auth entre cuentas y cambios dentro de una cuenta.
Se conservan las últimas 5000 validaciones por servidor. No hay sanciones automáticas.

## Comprobación local

npm test carga todos los módulos sin iniciar sesión en Discord y prueba
aislamiento de tres servidores, reglas Anti-DU, parsing y aprobación/rechazo.
Las pruebas sustituyen la persistencia por memoria; no modifican los datos reales.
Las migraciones y una aprobación real en Discord requieren la activación anterior.

## Torneos y web — cambios locales del 10/09

Antes de desplegar estos comandos, ejecutar también
`supabase/migrations/202609100001_tournament_formats.sql`.
La migración agrega configuración, metadatos de fases y una función atómica
para insertar el fixture sin duplicar rondas por clics simultáneos.
No se aplicó automáticamente.

- `/creartorneo`: borrador privado con edición de ida/vuelta, clasificados y
  etiquetas. Etiquetas: una por línea, por ejemplo `1-1 | #116633 | CAMPEON`.
  Se guarda al confirmar; cancelar no crea un torneo. Vence a los 20 minutos
  o al reiniciar el bot.
- Liga: todos contra todos. Copa: eliminación directa, cupos potencia de dos.
- Dos grupos: mitad de clubes en A, mitad en B; clasificados cruzados.
- `/schedule crear` requiere el cupo completo y no reemplaza fixtures existentes.
- `/schedule avanzar` genera la siguiente ronda una vez terminados los partidos.
  Usa marcador agregado con ida/vuelta; no aplica gol de visitante.
  Los empates deportivos bloquean el avance: la resolución de desempates todavía
  requiere implementación. No se elige un ganador arbitrario.
- Libertadores queda bloqueado hasta confirmar si se busca grupos clásicos
  o fase de liga de Champions.

Web: franja de hasta 11 resultados con abreviaciones, liga/torneo y modalidad;
navegación centrada, Juegos deshabilitado, tabla lateral en partidos, tablas
por grupo y etiquetas de posición. Se conserva el bloque agrupado de Inicio.
Tiers incluye Individual/Colectivo, General/x3/x4/x5/x7 y columnas HT/LT
con los cortes de la web vieja. Calcula puntos desde estadísticas oficiales
(goles + asistencias/2 + valla/300 segundos).
Las insignias de modalidades son textuales por ahora; no se integraron
los archivos originales de los diseños adjuntos. No se inventan países.

Comprobación: pruebas locales del bot, TypeScript, lint y build.
La inspección visual no pudo hacerse porque no había navegador conectado.
No se hizo commit, push ni despliegue.
Se verificó por lectura que Supabase tiene las columnas valuacion y replay_url;
eso no confirma por sí solo la función ni una aprobación real.
La aprobación real sigue pendiente de identificar el mensaje de Discord a usar.
