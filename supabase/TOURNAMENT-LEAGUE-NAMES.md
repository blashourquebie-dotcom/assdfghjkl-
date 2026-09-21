# Nombres de torneos por liga

Aplicar `migrations/202609120002_tournament_league_names.sql` en Supabase y desplegar/reiniciar este bot en la misma ventana de mantenimiento. No ejecutar comandos con el bot antiguo después de cambiar la restricción: sus búsquedas no distinguen ligas y su antiguo upsert usa la clave anterior.

La migración es transaccional, repetible y no borra ni renombra torneos. Mantiene sus IDs, clubes, fixture y estadísticas. La unicidad pasa de `(modalidad_id, nombre)` a `(modalidad_id, tipo, nombre)`.

Las consultas de torneos de comandos slash, autocompletado, componentes y comandos con prefijo usan el servidor como contexto:

- 1400962843674804264: exclusivo / Road to Glory.
- 1513342723594129458: tematico.
- 1293616776747286631: ash.
- 1477848311019864106: configurar `HAXOLE_TEST_LEAGUE=ash`, `exclusivo` o `tematico` en el entorno del bot y reiniciarlo.

Si no hay una liga resuelta y hay nombres ambiguos, se rechaza la búsqueda/lista, no se toma el primer torneo. Los procesos internos sin interacción también deben resolver su liga cuando existan nombres repetidos. Esto no cambia fichajes ni capitanías.

`/creartorneo tipo:...` conserva la elección explícita del administrador. Crear el mismo nombre dos veces en una misma liga y modalidad sigue siendo un error y no actualiza ni sobrescribe el torneo anterior.

Verificar tras desplegar: crear LIGA T1 en x3/ASH y x3/Exclusivo; repetir en ASH debe fallar; comprobar `/schedule`, `/torneo`, autocompletado e informes desde cada servidor. La migración no fue ejecutada remotamente por el agente.
