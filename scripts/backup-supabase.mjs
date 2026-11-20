// scripts/backup-supabase.mjs
//
// Descarga TODO el contenido de las tablas de Supabase y lo guarda en /backups.
// Es un respaldo INDEPENDIENTE de Supabase: si el proyecto se pierde, se borra o se corrompe,
// los datos siguen existiendo acá, versionados en el historial de git.
//
// Qué guarda:
//   backups/<tabla>.latest.json                 → la última foto (se reemplaza en cada corrida)
//   backups/diarios/<AAAA-MM-DD>/<tabla>.json.gz → una foto por día (se conservan 45 días en la carpeta;
//                                                  las anteriores siguen en el historial de git)
//   backups/mensuales/<AAAA-MM-01>-<tabla>.json → una foto el día 1 de cada mes (para siempre)
//
// Protección: si una tabla trae muchas menos filas que el respaldo anterior (por ejemplo,
// alguien vació datos), NO se pisa el respaldo bueno: se guarda aparte como "sospechoso"
// y la corrida termina con error para que GitHub mande el aviso por mail.

import { writeFile, readFile, mkdir, readdir, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const SUPABASE_URL = 'https://vadqwxrbonrbohvbeqdo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8oUx8EJHl67PKy2gIJYvWA_wjX9AhDe';

// tabla → columnas de la clave (para paginar con orden fijo y no saltear ni repetir filas)
const TABLAS = {
  campanas_diario: 'year,month,row_key,day',
  aux_diario: 'year,month,categoria,auxiliar,day',
  meta: 'key',
  historial_cambios: 'id',
  auditoria: 'id',
  campanas_mensual: null, // tablas viejas, ya no las usa la app
  aux_mensual: null,
};
// Tablas que solo crecen o casi: si de golpe traen menos de este % del respaldo anterior, se frena.
const MINIMO_PORCENTAJE = 0.9;
const DIAS_A_CONSERVAR = 45;

async function fetchTodo(tabla, orden) {
  const filas = [];
  let desde = 0;
  const tamanoPagina = 1000;
  while (true) {
    const ord = orden ? '&order=' + orden.split(',').map(c => `${c}.asc`).join(',') : '';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=*${ord}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: `${desde}-${desde + tamanoPagina - 1}`,
      },
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 400) {
        console.warn(`Aviso: la tabla "${tabla}" no existe o no respondió (${res.status}), se omite.`);
        return null;
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

async function cantidadAnterior(tabla) {
  try { return JSON.parse(await readFile(`backups/${tabla}.latest.json`, 'utf8')).length; }
  catch { return null; }
}

async function main() {
  const ahora = new Date();
  // fecha en hora argentina para nombrar las carpetas
  const fecha = new Date(ahora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  console.log(`Respaldo ${ahora.toISOString()} (carpeta ${fecha})`);
  await mkdir('backups', { recursive: true });
  await mkdir(`backups/diarios/${fecha}`, { recursive: true });

  const conteos = {};
  const problemas = [];
  for (const [tabla, orden] of Object.entries(TABLAS)) {
    const filas = await fetchTodo(tabla, orden);
    if (filas === null) continue;
    const antes = await cantidadAnterior(tabla);
    conteos[tabla] = antes == null ? `${filas.length}` : `${antes} → ${filas.length}`;

    if (antes && filas.length < antes * MINIMO_PORCENTAJE) {
      const archivo = `backups/sospechoso-${fecha}-${tabla}.json`;
      await writeFile(archivo, JSON.stringify(filas));
      problemas.push(`${tabla}: el respaldo anterior tenía ${antes} filas y ahora vienen ${filas.length}. NO se pisó el respaldo bueno (lo nuevo quedó en ${archivo}).`);
      continue;
    }
    await writeFile(`backups/${tabla}.latest.json`, JSON.stringify(filas, null, 2));
    await writeFile(`backups/diarios/${fecha}/${tabla}.json.gz`, gzipSync(JSON.stringify(filas)));
  }
  console.log('Filas (anterior → ahora):', conteos);

  // Foto mensual permanente el día 1
  if (fecha.endsWith('-01')) {
    await mkdir('backups/mensuales', { recursive: true });
    for (const tabla of ['campanas_diario', 'aux_diario', 'meta', 'historial_cambios', 'auditoria']) {
      try {
        const contenido = await readFile(`backups/${tabla}.latest.json`, 'utf8');
        await writeFile(`backups/mensuales/${fecha}-${tabla}.json`, contenido);
      } catch {}
    }
  }

  // Limpieza de la carpeta de diarios (lo viejo sigue en el historial de git)
  const limite = new Date(ahora.getTime() - DIAS_A_CONSERVAR * 86400000).toISOString().slice(0, 10);
  for (const dir of await readdir('backups/diarios')) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dir) && dir < limite) await rm(`backups/diarios/${dir}`, { recursive: true, force: true });
  }

  if (problemas.length) {
    console.error('\n⚠️  ATENCIÓN — posible pérdida de datos:\n' + problemas.join('\n'));
    process.exitCode = 1; // se commitea igual lo que sí está bien, y la corrida queda marcada con error
  }
  console.log('Respaldo guardado en /backups.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
