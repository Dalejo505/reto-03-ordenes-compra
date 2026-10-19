// Carga .env (si existe) antes que cualquier otro módulo lea process.env.
// Las variables ya definidas en el entorno tienen prioridad sobre el archivo.
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ruta = fileURLToPath(new URL("../.env", import.meta.url))
if (existsSync(ruta)) process.loadEnvFile(ruta)
