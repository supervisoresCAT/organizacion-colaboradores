// scripts/backup-supabase.mjs
//
// Descarga TODO el contenido de campanas_mensual, aux_mensual y meta desde Supabase
// y lo guarda en /backups como JSON. Esto es un respaldo INDEPENDIENTE de Supabase:
// si el proyecto de Supabase se pierde, se borra o se corrompe, los datos siguen
// existiendo acá, versionados en el historial de git.

import { writeFile, mkdir } from 'node:fs/promises';

const SUPABASE_URL = 'https://vadqwxrbonrbohvbeqdo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8oUx8EJHl67PKy2gIJYvWA_wjX9AhDe';

async function fetchTodo(tabla) {
  const filas = [];
  let desde = 0;
  const tamanoPagina = 1000;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=*`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: `${desde}-${desde + tamanoPagina - 1}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Error consultando ${tabla}: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    filas.push(...data);
    if (data.length < tamanoPagina) break;
    desde += tamanoPagina;
  }
  return filas;
}

async function main() {
  console.log('Descargando tablas de Supabase para el respaldo...');
  const campanas = await fetchTodo('campanas_mensual');
  const aux = await fetchTodo('aux_mensual');
  const meta = await fetchTodo('meta');

  console.log(`Traído: ${campanas.length} filas de campañas, ${aux.length} de auxiliares, ${meta.length} de meta.`);

  await mkdir('backups', { recursive: true });
  await writeFile('backups/campanas_mensual.latest.json', JSON.stringify(campanas, null, 2));
  await writeFile('backups/aux_mensual.latest.json', JSON.stringify(aux, null, 2));
  await writeFile('backups/meta.latest.json', JSON.stringify(meta, null, 2));

  // Además del "latest" (que siempre se pisa), una foto fechada una vez por mes
  // como punto de restauración a más largo plazo, sin acumular archivos de más.
  if (new Date().getUTCDate() <= 7) {
    const fecha = new Date().toISOString().slice(0, 10);
    await mkdir('backups/mensuales', { recursive: true });
    await writeFile(`backups/mensuales/${fecha}-campanas_mensual.json`, JSON.stringify(campanas, null, 2));
    await writeFile(`backups/mensuales/${fecha}-aux_mensual.json`, JSON.stringify(aux, null, 2));
    await writeFile(`backups/mensuales/${fecha}-meta.json`, JSON.stringify(meta, null, 2));
  }

  console.log('Respaldo guardado en /backups.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
