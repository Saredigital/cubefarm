# Guía de revisión de cubefarm

Reglas que el revisor automático del Control Center aplica a los PRs de este repo.

- `npm run typecheck`, `npm test` (Vitest) y `npm run build` deben pasar en los dos runners de CI (ubuntu y windows); la lógica nueva debe venir con tests `*.test.ts` junto al código, sin red, sin `gh`, sin sesiones de Claude ni el `~/.sareoffice` real.
- TypeScript estricto ESM: no se aceptan `any` explícitos ni `// @ts-ignore` nuevos; el servidor importa con extensión `.ts`, el cliente sin extensión; comillas simples y punto y coma.
- Paridad con la demo: todo método nuevo de `Backend`, herramienta del CEO o capacidad tiene su versión simulada en `server/demo.ts`.
- Estado nuevo de la interfaz en `shared/types.ts`, el snapshot y un evento tratado en `store.ts`; REST solo para comandos.
- Windows primero: rutas con `path.join` / `path.resolve` y procesos con `execFile` y argumentos en array, nunca comandos de shell construidos como cadenas.
- Las rutas privadas de empresa mantienen sesión, CSRF y autorización por recurso; los datos de correo nunca entran en snapshots, diario, voz ni terminales, y las pruebas de `server/company*/` y `server/mail/` no conectan cuentas reales.
- Textos de usuario y prompts de agentes en español de España; sin traducir identificadores ni literales que se parsean (`Closes #N`, `swarm:skip`).
- El cambio debe limitarse a lo que pide la issue: sin refactors, reformateos ni dependencias nuevas que no se hayan pedido.
