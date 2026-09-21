# Pases libres en Copa

## Activación

Aplicar primero `supabase/migrations/202609100001_tournament_formats.sql` si aún no está instalada y luego `202609100002_cup_byes.sql` en la base compartida. La web incluye copias y su SQL consolidado; no hace falta ejecutar ambas copias. Reiniciar/desplegar el bot para registrar `/torneo` y publicar la web.

## Ejemplo: 14 clubes

1. Crear una Copa de 14 equipos con `/creartorneo` e inscribir los clubes.
2. Consultar `/torneo modalidad:x3 torneo:Copa` para ver los inscriptos y los dos pases necesarios.
3. Guardar `/torneo modalidad:x3 torneo:Copa pases_libres:Club Uno; Club Dos` (nombres exactos separados por punto y coma; también acepta IDs).
4. Ejecutar `/schedule accion:crear torneo:Copa modalidad:x3`: genera seis cruces de octavos, sin partidos ficticios para los dos clasificados.
5. Cuando todos los octavos estén resueltos, `/schedule accion:avanzar` incorpora esos dos clubes junto con los seis ganadores y genera los cuartos.

Solo administradores. Los pases se configuran para la primera ronda y no pueden cambiarse cuando existe fixture. Deben ser clubes inscriptos, distintos y exactamente los necesarios para completar la siguiente potencia de dos. Una Copa de 16 no requiere pases. Se conserva la opción ida/vuelta. Las llaves empatadas siguen requiriendo un desempate antes de avanzar.

La web muestra los pases en Posiciones, sin contarlos como partidos o victorias. Resultados y Fixture siguen siendo listas.

Verificación local: `npm test` en el bot; `npm run typecheck`, `npm run lint`, `node tests/profile-links.cjs` y `npm run build` en la web. La migración requiere verificación al aplicarse en Supabase: las pruebas locales no ejecutan PostgreSQL ni Discord.
