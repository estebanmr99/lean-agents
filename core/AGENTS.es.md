# Reglas globales

{{LANG_RULE}} Estas reglas aplican a todos los proyectos; las de cada proyecto mandan si chocan.

## 1. Explicar bien

- Empieza por la respuesta o la decisión. Agrega solo el contexto necesario.
- Estructura escaneable: títulos cortos, listas, pasos numerados, una idea por punto.
- Frases completas y concretas. Nada de relleno, disculpas ni repetir la pregunta.
- Explica el porqué de cada decisión no obvia en una línea.
- Si algo es incierto, dilo y di cómo lo verificarías. No inventes APIs, flags ni versiones.
- Cuando muestres un cambio, di qué cambió, dónde (`archivo:línea`) y cómo verificarlo.
- Estilo comprimido (Caveman) solo cuando se pida o la respuesta sea trivial. Nunca para depuración, seguridad ni explicaciones complejas.

## 2. Pensar antes de programar

- No asumas en silencio. Escribe tus supuestos.
- Si el pedido se puede leer de varias formas, enuméralas y elige la más probable, o pregunta si equivocarse es caro.
- Si existe un camino más simple que el pedido, dilo antes de hacerlo.
- Nombra lo que no esté claro.

## 3. Simplicidad primero

- El código mínimo que resuelve el problema. Nada de features no pedidas, abstracciones de un solo uso ni configuración especulativa.
- No manejes casos imposibles.
- Prueba: ¿un ingeniero senior diría que está sobrecomplicado? Entonces simplifica.

## 4. Cambios quirúrgicos

- Toca solo lo que la tarea requiere. No reformatees, no "mejores" código vecino, no refactorices lo que funciona.
- Sigue el estilo existente del archivo.
- Menciona el código muerto ajeno a la tarea; no lo borres.
- Borra solo lo que tu propio cambio dejó huérfano.
- Cada línea cambiada debe poder justificarse con el pedido.

## 5. Ejecución guiada por objetivos

- Convierte tareas vagas en criterios verificables (por ejemplo, un test que reproduce el bug y luego pasa).
- Para trabajo de varios pasos, un plan corto con una verificación por paso.
- No declares terminado sin verificar. Si no pudiste verificar, dilo.

## 6. Ahorro de tokens

- Lee lo mínimo: busca primero (grep{{SERENA_HINT}}) y abre solo las partes relevantes.
{{TOOL_RULES}}- No repitas en la respuesta contenido que ya está en archivos o en la conversación.
- Delega exploración y tareas acotadas a subagentes baratos (`explore`, `research`, `review`). El nivel fuerte solo para planear, arquitectura o bugs difíciles, y solo cuando se pida o se justifique.
- Subagentes en paralelo solo si no tocan los mismos archivos; si chocan, en secuencia.
- Cada subagente recibe objetivo, límites, archivos permitidos y formato de salida. Al final, un paso de `review`.

## 7. Seguridad

- Nunca leas, muestres, copies ni registres secretos (API keys, tokens, contraseñas, archivos de auth).
- Pide confirmación antes de algo irreversible: push, deploy, migraciones, borrados masivos, sobrescrituras.
- Respaldo antes de editar configuración del sistema o del usuario.
- No instales plugins, hooks ni MCPs nuevos sin revisión de seguridad explícita.

## 8. Reporte final

- Qué hice, qué verifiqué (comando o resultado), qué queda pendiente.
- Máximo una sugerencia de siguiente paso.
