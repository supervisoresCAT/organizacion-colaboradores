// scripts/backup-supabase.mjs
//
// Descarga TODO el contenido de las tablas de Supabase y lo guarda en /backups como JSON.
// Esto es un respaldo INDEPENDIENTE de Supabase: si el proyecto se pierde, se borra o se
// corrompe, los datos siguen existiendo acá, versionados en el historial de git.
// Corre una vez por día.
//
// campanas_diario / aux_diario: las tablas activas (una fila por día editado).
// campanas_mensual / aux_mensual: las tablas viejas (una fila por mes completo), ya no las
// usa la app, pero se siguen respaldando por las dudas mientras nadie las borre a mano.

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
      if (res.status === 404 || res.status === 400) {
        console.warn(`Aviso: la tabla "${tabla}" no existe o no respondió, se omite.`);
        return [];
      }
      throw new Error(`Error consultando ${tabla}: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    filas.push(...data);
    if (data.length < tamanoPagina) break;
    desde += tamanoPagina;
  }
  return filas;
}

async function respaldarTabla(tabla) {
  const filas = await fetchTodo(tabla);
  await writeFile(`backups/${tabla}.latest.json`, JSON.stringify(filas, null, 2));
  return filas.length;
}

async function main() {
  console.log('Descargando tablas de Supabase para el respaldo diario...');
  await mkdir('backups', { recursive: true });

  const tablas = ['campanas_diario', 'aux_diario', 'meta', 'historial_cambios', 'campanas_mensual', 'aux_mensual'];
  const conteos = {};
  for (const tabla of tablas) {
    conteos[tabla] = await respaldarTabla(tabla);
  }
  console.log('Filas respaldadas:', conteos);

  // Además del "latest" (que siempre se pisa), una foto fechada el día 1 de cada mes
  // como punto de restauración a más largo plazo, sin acumular un archivo por día.
  if (new Date().getUTCDate() === 1) {
    const fecha = new Date().toISOString().slice(0, 10);
    await mkdir('backups/mensuales', { recursive: true });
    for (const tabla of ['campanas_diario', 'aux_diario', 'meta']) {
      const filas = await fetchTodo(tabla);
      await writeFile(`backups/mensuales/${fecha}-${tabla}.json`, JSON.stringify(filas, null, 2));
    }
  }

  console.log('Respaldo guardado en /backups.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
