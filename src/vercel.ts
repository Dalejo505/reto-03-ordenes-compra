// Entrada de la función serverless de Vercel. En Vercel el directorio de trabajo es la raíz
// del proyecto desplegado (fixtures/, agent/ y src/knowledge/ se incluyen con includeFiles)
// y solo /tmp es escribible, así que out/ se redirige allí con OUT_DIR.
process.env.OUT_DIR ||= "/tmp/out"

const { crearManejador } = await import("./app")

export default crearManejador(process.cwd())
