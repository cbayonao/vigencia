export function directorioDatos({ empaquetada, userData, repo, env = {} }) {
  if (env.VIGENCIA_DATOS) return env.VIGENCIA_DATOS;
  if (!empaquetada) return repo;
  return userData;
}
