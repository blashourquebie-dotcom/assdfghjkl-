# Anti-DU: comparación con asociaciones anteriores

Las coincidencias se atribuyen a la primera asociación conocida de cada dato con un Discord. No son simétricas:

- A tiene datos registrados y entra: sin conflicto.
- B entra con los datos que ya estaban asociados a A: se informa el conflicto de B con A.
- A vuelve: las entradas posteriores de B no marcan a A.
- B vuelve: haber confirmado su propia entrada no borra el conflicto anterior.

Se consideran el historial de entradas confirmadas de la liga y las vinculaciones guardadas de las ligas autorizadas, respetando sus fechas. Un índice persistente por liga (`antiDuOrigins`) conserva las primeras asociaciones aunque se recorte el historial reciente. Sólo se guardan huellas HMAC, Discord y fecha; no IP/conn/auth en texto en este índice. Se inicializa automáticamente con los datos existentes al procesar nuevas validaciones, sin borrar el historial.

Cuando faltan fechas se conserva el orden de inserción de los datos históricos sin fecha. Las fechas conocidas tienen prioridad; empates exactos entre cuentas se conservan como ambiguos y requieren revisión. La primera asociación es evidencia de registro, no prueba de identidad ni de uso exclusivo de una red.

Cambiar IP, conn o auth dentro de una cuenta no genera sospecha por sí solo. Compartir datos con una asociación anterior de otro Discord sí genera un indicador. No se conceden permisos ni se expulsa a nadie por el indicador. Compartir red puede ser legítimo.

La autovalidación conserva sus requisitos: coincidencia exacta con la entrada anterior de esa cuenta, confirmación manual menor a tres horas, coincidencia por auth y ningún conflicto anterior. Cambiar datos puede exigir una nueva confirmación sin ser DU. Las validaciones automáticas no renuevan la ventana de tres horas.

## Avisos

Los avisos Anti-DU muestran el jugador, el indicador, los estados de IP/conn/auth sin sus valores, la cuenta asociada antes si existe conflicto y el método de validación. No incluyen datos, versión, owner ni coincidencias del hoster. El aviso separado `Host creado` conserva esa función en su webhook propio.

Desplegar el backend para aplicar la corrección a los nuevos avisos. No hace falta reemplazar los scripts de las salas para este cambio. Los mensajes históricos de Discord no se editan ni eliminan automáticamente.

Pruebas: `node --test tests/*.test.js`; casos específicos en `tests/antiDuOwnership.test.js`.
