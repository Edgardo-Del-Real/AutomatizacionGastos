# Deploy online — estado y runbook (2026-11-03)

## Hecho

| Paso | Estado |
|---|---|
| Supabase (base) | **Listo** — proyecto `rita`, ref `dndqmodcpffazbcdkskx`, región `sa-east-1` |
| Esquema | **Listo** — las 11 migraciones de Prisma aplicadas |
| Datos | **Listos** — 35 movimientos, 18 categorías, misma suma ($1.880.825) |
| Imagen de Render | **Verificada** — corre contra Supabase: migraciones, `/health`, login, datos |
| Bot local | Apuntado a Supabase (una sola fuente de verdad) |
| Render | **Listo** — https://rita-api.onrender.com (docker, free, ohio) |
| Vercel | **Listo** — https://rita-dashboard-beta.vercel.app |

## Credenciales de la base

El rol de Prisma es `rita_app` (no `postgres`: Supabase no permite cambiarle la clave por SQL).

```
DATABASE_URL=postgresql://rita_app.dndqmodcpffazbcdkskx:ritacc64dd848288e6a95f4507baea350653@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=10&pool_timeout=20
DIRECT_URL=postgresql://rita_app.dndqmodcpffazbcdkskx:ritacc64dd848288e6a95f4507baea350653@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Trampa encontrada: el pooler del proyecto vive en **`aws-1`**, no `aws-0` (el de la región no siempre es el mismo; si da `tenant/user not found`, probar el otro). La conexión "directa" (`db.<ref>.supabase.co`) es solo IPv6, por eso `DIRECT_URL` usa el **session pooler** en 5432.

### Por qué session pooler y no transaction pooler

Medido contra esta misma base:

| Configuración | Por query | 8 queries en paralelo |
|---|---|---|
| transaction pooler `:6543` + `pgbouncer=true`, `connection_limit=1` | ~205 ms | 1654 ms |
| transaction pooler `:6543`, `connection_limit=10` | ~202 ms | 873 ms |
| **session pooler `:5432`, `connection_limit=10`** | **~42 ms** | **460 ms** |

`pgbouncer=true` obliga a Prisma a renunciar a los prepared statements, y cada query paga varios round trips extra. Con Render en Ohio y Supabase en São Paulo esa diferencia se amplifica: en producción cada query costaba ~1,1 s y el resumen 10 s. El transaction pooler es para serverless; esto es un contenedor de larga vida, así que corresponde el de sesión.


## Render (hecho)

1. `New` → `Blueprint` → repositorio → Render lee `render.yaml`.
2. Secretos:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | el de arriba (5432, session pooler) |
| `DIRECT_URL` | el de arriba (5432) |
| `AUTH_SECRET` | `8f3c1c2e4d5b6a798877665544332211ffeeddccbbaa99887766554433221100` |
| `AUTH_USERS` | ver abajo |
| `TELEGRAM_BOT_TOKEN` | `apps/api/.env` |
| `HOUSEHOLD_MEMBERS` | `apps/api/.env` |
| `GROQ_API_KEY` | `apps/api/.env` |

`AUTH_USERS` (claves definitivas, una entrada por persona, unidas con `;`):

```powershell
node scripts/hash-password.mjs default TU_CLAVE
node scripts/hash-password.mjs rita CLAVE_DE_RITA
```

3. Al terminar, Render da una URL tipo `https://rita-api.onrender.com`.

## Vercel (hecho)

1. Import del repo (el `vercel.json` ya define build y salida).
2. Reemplazar `REPLACE-WITH-RENDER-URL` en `vercel.json` por la URL de Render y pushear.
3. Verificar que el login funcione desde la URL de Vercel (cookie first-party vía rewrite).

## Corte (crítico)

Antes de que Render quede vivo: **`rita.cmd down`**. Dos pollers con el mismo token de Telegram = 409 y el bot deja de contestar.

## Pendiente después

- Aislamiento + código de aprobación (hoy, logueados, los dos ven lo mismo).
- Backup automático de Supabase.
- Render free duerme a los 15 min sin tráfico: el bot contesta recién cuando alguien abre el dashboard.
