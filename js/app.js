/* =========================================================================
   GEOINBASEHA — Geovisor de información básica exploratoria e histórica
   de acuíferos. Lógica principal de la aplicación (Leaflet + JS vanilla).
   ========================================================================= */

/* -------------------------------------------------------------------------
   0) Utilidades
   ------------------------------------------------------------------------- */
const PALETA = {
  vino: '#611232',
  oro: '#a57f2c',
  beige: '#DDC9A3',
  magenta: '#9d2449',
  gris: '#98989A',
  azul: '#155DFC'
};

function normaliza(txt){
  if (txt === null || txt === undefined) return '';
  return txt.toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toUpperCase().trim();
}

/* Los tres archivos de datos no siempre usan el mismo nombre "oficial" de
   estado: estados.geojson trae el nombre completo INEGI ("Coahuila de
   Zaragoza"), mientras que acuiferos.geojson y el Excel de pozos usan la
   forma corta ("COAHUILA"). Comparar la cadena completa fallaría justo para
   Coahuila y Durango (las dos entidades de este dataset). En su lugar,
   comparamos solo la primera palabra, que siempre es el nombre base del
   estado en las convenciones de nombres oficiales de México. */
function primeraPalabra(txt){
  const n = normaliza(txt);
  return n.split(' ')[0] || '';
}
function mismoEstado(nombreA, nombreB){
  if (!nombreA || !nombreB) return false;
  return primeraPalabra(nombreA) === primeraPalabra(nombreB);
}

function descargarBlob(contenido, nombreArchivo, tipoMime){
  const blob = new Blob([contenido], { type: tipoMime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Definición de simbología por TIPO_INF (icono SVG en línea, colores gob.mx) */
const SIMBOLOGIA = {
  'CROQUIS': {
    color: PALETA.vino,
    etiqueta: 'Croquis',
    svg: (c) => `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="${c}" d="M12 2C7.6 2 4 5.6 4 10c0 6 8 12 8 12s8-6 8-12c0-4.4-3.6-8-8-8zm0 10.5A2.5 2.5 0 1 1 12 7.5a2.5 2.5 0 0 1 0 5z"/></svg>`
  },
  'HIDROGEOLÓGICA': {
    color: PALETA.oro,
    etiqueta: 'Hidrogeológica',
    svg: (c) => `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="7" y="2.5" width="10" height="19" rx="4" fill="none" stroke="${c}" stroke-width="1.6"/><rect x="7" y="9" width="10" height="7" fill="${c}" opacity="0.55"/><rect x="7" y="16" width="10" height="5.5" fill="${c}"/></svg>`
  },
  'HIDROGEOQUÍMICO': {
    color: PALETA.magenta,
    etiqueta: 'Hidrogeoquímico',
    svg: (c) => `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="${c}" stroke-width="1.6" d="M9 2h6M10 2v6l-5 10a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-10V2"/><path fill="${c}" opacity="0.6" d="M6.5 15.5h11l1 2a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z"/></svg>`
  },
  'PROFUNDIDAD': {
    color: PALETA.gris,
    etiqueta: 'Profundidad',
    svg: (c) => `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="${c}" d="M12 2C9 6 6 9.5 6 13a6 6 0 0 0 12 0c0-3.5-3-7-6-11z" opacity="0.85"/><path fill="none" stroke="${c}" stroke-width="1.4" d="M18 8v10M16 16l2 2 2-2M18 8l-2 2M18 8l2 2"/></svg>`
  },
  'OTRO': {
    color: '#444444',
    etiqueta: 'Otro',
    svg: (c) => `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="7" fill="${c}" opacity="0.8"/></svg>`
  }
};

function iconoPozo(tipo){
  const def = SIMBOLOGIA[tipo] || SIMBOLOGIA['OTRO'];
  return L.divIcon({
    className: 'pozo-icon',
    html: `<div style="filter:drop-shadow(0 1px 1px rgba(0,0,0,.5));">${def.svg(def.color)}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -10]
  });
}

/* -------------------------------------------------------------------------
   1) Mapa base
   ------------------------------------------------------------------------- */
const map = L.map('map', { zoomControl: false, minZoom: 4, maxZoom: 18 });
const VISTA_INICIAL = { center: [25.75, -103.35], zoom: 9 }; // Región Lagunera (Coahuila-Durango)
map.setView(VISTA_INICIAL.center, VISTA_INICIAL.zoom, { animate: false });

const capaCycleOSM = L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors, CyclOSM', maxZoom: 20
});
const capaOpenTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Style: OpenTopoMap', maxZoom: 17
});
const capaEsriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri — World Topo Map', maxZoom: 19
});
const capaEsriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri — World Imagery', maxZoom: 19
});

capaCycleOSM.addTo(map);

const basemaps = {
  'CycleOSM': capaCycleOSM,
  'Open TopoMap': capaOpenTopo,
  'ESRI TopoMap': capaEsriTopo,
  'ESRI Satélite': capaEsriSat
};
L.control.layers(basemaps, null, { position: 'topright', collapsed: false }).addTo(map);

/* -------------------------------------------------------------------------
   2) Control de Zoom + botón "Vista predeterminada" (Home)
   ------------------------------------------------------------------------- */
L.control.zoom({ position: 'topleft' }).addTo(map);

const HomeControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function(){
    const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-home');
    const a = L.DomUtil.create('a', '', div);
    a.href = '#';
    a.title = 'Vista Inicial';
    a.innerHTML = '⌂';
    a.style.width = '26px'; a.style.height = '26px'; a.style.lineHeight = '26px';
    a.style.display = 'block'; a.style.textAlign = 'center';
    L.DomEvent.on(a, 'click', function(e){
      L.DomEvent.stop(e);
      map.setView(VISTA_INICIAL.center, VISTA_INICIAL.zoom, { animate: false });
    });
    return div;
  }
});
map.addControl(new HomeControl());

/* -------------------------------------------------------------------------
   3) Herramienta de medición de distancia lineal (control propio, sin plugins externos)
   ------------------------------------------------------------------------- */
const MeasureControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function(){
    const div = L.DomUtil.create('div', 'measure-control leaflet-bar');

    const btnMedir = L.DomUtil.create('button', '', div);
    btnMedir.innerHTML = '📏';
    btnMedir.title = 'Medir distancia lineal';

    const btnLimpiar = L.DomUtil.create('button', '', div);
    btnLimpiar.innerHTML = '🗑';
    btnLimpiar.title = 'Limpiar mediciones';

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(btnMedir, 'click', () => toggleMedicion(btnMedir));
    L.DomEvent.on(btnLimpiar, 'click', () => limpiarMediciones());
    return div;
  }
});
map.addControl(new MeasureControl());

let midiendo = false;
let puntosMedicion = [];
let capaMedicion = L.layerGroup().addTo(map);

/* Capa exclusiva para el círculo pulsante que resalta, de forma temporal, el
   marcador correspondiente a la fila que el usuario seleccionó en la tabla
   (o al pozo que clickeó directamente en el mapa). Se mantiene separada de
   capaPozos para poder limpiarla sin afectar los marcadores reales. */
let capaResaltado = L.layerGroup().addTo(map);
let timeoutResaltado = null;

function resaltarPuntoEnMapa(lat, lng){
  capaResaltado.clearLayers();
  if (timeoutResaltado) clearTimeout(timeoutResaltado);

  const iconoPulso = L.divIcon({
    className: 'resaltado-pulso-icon',
    html: '<div class="pulso-anillo"></div><div class="pulso-anillo pulso-anillo-2"></div>',
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
  L.marker([lat, lng], {
    icon: iconoPulso,
    interactive: false,   // deja pasar el clic hacia el marcador real de abajo
    zIndexOffset: 1000    // se dibuja por encima de los demás pozos
  }).addTo(capaResaltado);

  // El resaltado desaparece solo después de unos segundos, para no dejar
  // marcas viejas acumuladas si el usuario sigue explorando otras filas/pozos.
  timeoutResaltado = setTimeout(() => capaResaltado.clearLayers(), 4000);
}

function toggleMedicion(btn){
  midiendo = !midiendo;
  btn.classList.toggle('active', midiendo);
  puntosMedicion = [];
  map.getContainer().style.cursor = midiendo ? 'crosshair' : '';
  
  if (midiendo) {
    // Cuando se inicia modo de medición
    map.doubleClickZoom.disable();
    // Desabilitar PopUps de pozos cuando se está midiendo
    capaPozos.eachLayer(layer => {
      if (layer.closePopup) layer.closePopup();
      if (layer.setPopupContent) layer.unbindPopup();
    });
  } else {
    // Cuando se termina modo de medición
    map.doubleClickZoom.enable();
    // Rehabilitar PopUps cuando se termina de medir
    capaPozos.eachLayer(layer => {
      if (layer.feature && layer.feature.properties) {
        layer.bindPopup(popupPozo(layer.feature.properties));
      }
    });
  }
}

function limpiarMediciones(){
  puntosMedicion = [];
  capaMedicion.clearLayers();
}

function haversine(a, b){
  const R = 6371000;
  const toRad = (v) => v * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Usar mousedown en lugar de click para capturar el evento ANTES de que se abran los PopUps
// Esto permite medir incluso cuando hay elementos (polígonos, marcadores) debajo del cursor
map.on('mousedown', function(e){
  if (!midiendo) return;
  
  // Prevenir que el evento se propague a elementos debajo (PopUps, etc)
  L.DomEvent.stopPropagation(e.originalEvent);
  
  const latlng = e.latlng;
  puntosMedicion.push(latlng);
  
  // Dibujar punto inicial (siempre, incluso sobre elementos)
  L.circleMarker(latlng, { 
    radius: 4, 
    color: PALETA.magenta, 
    fillOpacity: 1 
  }).addTo(capaMedicion);
  
  // Si hay más de un punto, dibujar línea y distancia
  if (puntosMedicion.length > 1){
    const p1 = puntosMedicion[puntosMedicion.length - 2];
    const p2 = puntosMedicion[puntosMedicion.length - 1];
    
    // Línea conectora
    L.polyline([p1, p2], { 
      color: PALETA.magenta, 
      weight: 3 
    }).addTo(capaMedicion);
    
    // Calcular distancia
    const dist = haversine(p1, p2);
    const mid = L.latLng((p1.lat + p2.lat)/2, (p1.lng + p2.lng)/2);
    
    // Etiqueta de distancia
    L.marker(mid, {
      icon: L.divIcon({ 
        className: 'measure-tooltip', 
        html: `${(dist/1000).toFixed(3)} km`, 
        iconSize: null 
      }),
      interactive: false
    }).addTo(capaMedicion);
  }
});

// Terminar medición al hacer doble clic
map.on('dblclick', function(){ 
  if (midiendo) { 
    puntosMedicion = []; 
  } 
});

/* -------------------------------------------------------------------------
   4) Carga de capas GeoJSON (estados, acuíferos, pozos)
   ------------------------------------------------------------------------- */
let capaEstados, capaAcuiferos, capaPozos;
let datosPozos = [];       // features originales de pozos.geojson
let datosAcuiferos = [];   // features originales de acuiferos.geojson
let datosEstados = [];

/* Referencia plana a cada polígono de acuífero ya dibujado (para poder
   recorrerlos fácilmente aunque estén repartidos en varias sub-capas). */
let capasAcuiferoIndividuales = [];
/* Qué estados ya se agregaron al mapa (para no volver a construirlos). */
const estadosGeoCargados = new Set();

/* Renderer canvas: dibuja los polígonos de estados/acuíferos en un único
   <canvas> en vez de un <path> SVG por cada uno. */
const rendererPoligonos = L.canvas({ padding: 0.5 });

const estiloEstados = { color: PALETA.vino, weight: 2.8, fillOpacity: 0.02, fillColor: PALETA.vino };
const estiloAcuiferos = { color: PALETA.azul, weight: 1.4, fillOpacity: 0.06, fillColor: PALETA.azul };
const estiloAcuiferoSeleccionado = { color: PALETA.magenta, weight: 3, fillOpacity: 0.12, fillColor: PALETA.magenta };

/* Umbral de zoom a partir del cual se muestran las etiquetas de los acuíferos.
   Por debajo de este nivel (vista estatal/nacional) se ocultan para que no se
   amontonen; el geovisor abre por defecto en zoom 9 (vista regional), donde ya
   se ven con buen espaciado. Ajusta este número si quieres que aparezcan antes
   o después al hacer zoom. */
const UMBRAL_ZOOM_ETIQUETAS_ACUIFERO = 8;

function actualizarVisibilidadEtiquetasAcuifero(){
  const contenedorMapa = document.getElementById('map');
  if (map.getZoom() < UMBRAL_ZOOM_ETIQUETAS_ACUIFERO){
    contenedorMapa.classList.add('oculta-etiquetas-acuifero');
  } else {
    contenedorMapa.classList.remove('oculta-etiquetas-acuifero');
  }
}
map.on('zoomend', actualizarVisibilidadEtiquetasAcuifero);

/* Además del umbral por zoom, ocultamos TODAS las etiquetas (estados y
   acuíferos) mientras el mapa se está moviendo, sin importar si el movimiento
   viene de un pan, un zoom con rueda o un "salto" instantáneo (setView). */
const contenedorMapa = document.getElementById('map');
map.on('movestart zoomstart', () => contenedorMapa.classList.add('mapa-en-movimiento'));
map.on('moveend zoomend', () => {
  contenedorMapa.classList.remove('mapa-en-movimiento');
  actualizarVisibilidadEtiquetasAcuifero();
});

/* ---- Construcción de una sola capa de estado / acuífero (misma geometría
   exacta del archivo original, sin ningún cambio de precisión) ---- */
function construirCapaEstado(feature){
  return L.geoJSON(feature, {
    style: estiloEstados,
    renderer: rendererPoligonos,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(f.properties.NOMGEO, {
        permanent: true, direction: 'center', className: 'estado-label', interactive: false
      });
    }
  });
}

function construirCapaAcuifero(feature){
  const etiqueta = `${feature.properties.CLV_ACUI} - ${feature.properties.NOM_ACUI}`;
  const capa = L.geoJSON(feature, {
    style: estiloAcuiferos,
    renderer: rendererPoligonos,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(etiqueta, {
        permanent: true, direction: 'center', className: 'acuifero-label', interactive: false
      });
      // Popup al hacer clic: útil cuando la etiqueta permanente queda lejos
      // del punto de interés (zoom muy cercano) o está oculta por el zoom.
      layer.bindPopup(`<div class="popup-title">${etiqueta}</div>`);
    }
  });
  capa.eachLayer(l => capasAcuiferoIndividuales.push(l));
  return capa;
}

/* Agrega al mapa, SOLO la primera vez que se pide, el estado y sus acuíferos
   correspondientes. La geometría es exactamente la del archivo original — no
   se simplifica nada; lo único que cambia es CUÁNDO se le pide al navegador
   que la dibuje: en vez de cargar los 32 estados y 653 acuíferos del país de
   una sola vez (~1.35 millones de vértices), solo se agrega lo que el usuario
   realmente está consultando, lo cual evita el bloqueo del navegador. */
function cargarGeografiaEstado(nombreEstado){
  if (!nombreEstado) return;
  const yaCargado = [...estadosGeoCargados].some(n => mismoEstado(n, nombreEstado));
  if (yaCargado) return;
  estadosGeoCargados.add(nombreEstado);

  const featEstado = datosEstados.find(f => mismoEstado(f.properties.NOMGEO, nombreEstado));
  if (featEstado) construirCapaEstado(featEstado).addTo(capaEstados);

  const acuiferosDelEstado = datosAcuiferos.filter(f => mismoEstado(f.properties.NOM_EDO, nombreEstado));
  acuiferosDelEstado.forEach(f => construirCapaAcuifero(f).addTo(capaAcuiferos));

  actualizarVisibilidadEtiquetasAcuifero();
}

Promise.all([
  fetch('data/estados.geojson').then(r => r.json()),
  fetch('data/acuiferos.geojson').then(r => r.json()),
  fetch('data/pozos.geojson').then(r => r.json())
]).then(([estadosGJ, acuiferosGJ, pozosGJ]) => {

  datosEstados = estadosGJ.features;
  datosAcuiferos = acuiferosGJ.features;
  datosPozos = pozosGJ.features;
  
  // Crear mapeo de nombres cortos (del Excel) a nombres oficiales (del estados.geojson)
  // Esto permite mostrar "Coahuila de Zaragoza" en lugar de "COAHUILA"
  const mapeoNombresOficiales = {};
  datosPozos.forEach(pozo => {
    const nombreCorto = pozo.properties.NOM_EDO_OFICIAL;  // ej: "COAHUILA"
    
    // Si aún no lo hemos mapeado, buscar el nombre oficial
    if (nombreCorto && !mapeoNombresOficiales[nombreCorto]) {
      // Buscar en estados.geojson el nombre oficial que coincida
      const estadoOficial = datosEstados.find(est => {
        const nomGeo = normaliza(est.properties.NOMGEO);
        return nomGeo.startsWith(normaliza(nombreCorto.split(' ')[0]));
      });
      
      if (estadoOficial) {
        mapeoNombresOficiales[nombreCorto] = estadoOficial.properties.NOMGEO;
      } else {
        mapeoNombresOficiales[nombreCorto] = nombreCorto;  // Fallback: usar el original
      }
    }
  });
  
  // Guardar el mapeo para usarlo en toda la aplicación
  window.mapeoNombresOficiales = mapeoNombresOficiales;
  
  // Varios pozos comparten la misma CVE_LGJO (un legajo agrupa muchos pozos),
  // así que esa clave NO identifica un punto único en el mapa. Se agrega un
  // identificador incremental (__uid) a cada feature, para poder enlazar
  // "esta fila de la tabla" <-> "este marcador exacto del mapa" sin ambigüedad.
  datosPozos.forEach((f, i) => { f.properties.__uid = i; });

  capaEstados = L.layerGroup().addTo(map);
  capaAcuiferos = L.layerGroup().addTo(map);

  // Los 141 pozos de DURANGO y 62 pozos de COAHUILA están en esos dos estados:
  // cargamos de entrada solo esos dos estados (y sus acuíferos). El resto del país queda
  // disponible bajo demanda a través del filtro "Estado" o del buscador.
  cargarGeografiaEstado('COAHUILA');
  cargarGeografiaEstado('DURANGO');

  capaPozos = L.geoJSON(pozosGJ, {
    pointToLayer: (f, latlng) => L.marker(latlng, { icon: iconoPozo(f.properties.TIPO_INF) }),
    onEachFeature: (f, layer) => layer.bindPopup(popupPozo(f.properties))
  }).addTo(map);

  capaPozos.eachLayer(l => l.on('click', () => {
    seleccionarFilaTabla(l.feature.properties.__uid);
    const ll = l.getLatLng();
    resaltarPuntoEnMapa(ll.lat, ll.lng);
  }));

  construirLeyenda();
  poblarFiltroEstado();
  poblarTabla(datosPozos);
  poblarBuscador();

}).catch(err => {
  console.error('Error cargando capas GeoJSON:', err);
  alert('No se pudieron cargar los archivos de datos (data/*.geojson). Verifica que la carpeta "data" esté junto a index.html.');
});

/* -------------------------------------------------------------------------
   5) Popup de consulta y visualización (al hacer click en un pozo)
   ------------------------------------------------------------------------- */
function popupPozo(p){
  const campos = [
    ['CVE_LGJO', 'Clave de legajo'], ['CVE_POZO', 'Clave de pozo'], ['NOMB_POZO', 'Nombre'],
    ['CVE_EDO', 'Clave edo.'], ['NOM_EDO_OFICIAL', 'Estado'], ['AÑO', 'Año'],
    ['NOM_ACUIF', 'Acuífero'], ['TIPO_INF', 'Tipo de información'],
    ['PROF_TOT_m', 'Profundidad total (m)'], ['NE_M', 'Nivel estático (m)'], ['ND_M', 'Nivel dinámico (m)'],
    ['Ca', 'Ca (mg/L)'], ['Mg', 'Mg (mg/L)'], ['Na', 'Na (mg/L)'], ['Cl', 'Cl (mg/L)'],
    ['SO4', 'SO4 (mg/L)'], ['HCO3', 'HCO3 (mg/L)'], ['STD_ppm', 'STD (ppm)'],
    ['TEMP_°C', 'Temp. (°C)'], ['POT_H_s/u', 'pH (s/u)'], ['CE_Us/cm', 'CE (µS/cm)'], ['As_mg/L', 'As (mg/L)']
  ];
  let filas = '';
  campos.forEach(([campo, etiqueta]) => {
    const v = p[campo];
    if (v !== null && v !== undefined && v !== '') {
      filas += `<tr><td class="k">${etiqueta}</td><td>${v}</td></tr>`;
    }
  });
  // Buscar campo URL (puede tener espacio: "URL ")
  let liga = '';
  const urlField = Object.keys(p).find(k => k.trim() === 'URL');
  if (urlField && p[urlField]) liga = `<div style="margin-top:6px;"><a class="popup-link" href="${p[urlField]}" target="_blank" rel="noopener">Ver legajo original (PDF)</a></div>`;
  return `<div class="popup-title">${p.CVE_LGJO || ''} · ${SIMBOLOGIA[p.TIPO_INF] ? SIMBOLOGIA[p.TIPO_INF].etiqueta : (p.TIPO_INF || 'Sin clasificar')}</div>
          <table class="popup-table">${filas}</table>${liga}`;
}

/* -------------------------------------------------------------------------
   6) Leyenda / Simbología (panel lateral)
   ------------------------------------------------------------------------- */
function construirLeyenda(){
  const ul = document.getElementById('legend-list');
  ul.innerHTML = '';
  Object.entries(SIMBOLOGIA).forEach(([tipo, def]) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="legend-swatch">${def.svg(def.color)}</span><span>${def.etiqueta}</span>`;
    ul.appendChild(li);
  });
  const liAcu = document.createElement('li');
  liAcu.innerHTML = `<span class="legend-line" style="background:${PALETA.azul};"></span><span>Límite de acuífero</span>`;
  ul.appendChild(liAcu);
  const liEdo = document.createElement('li');
  liEdo.innerHTML = `<span class="legend-line" style="background:${PALETA.vino};"></span><span>Límite estatal</span>`;
  ul.appendChild(liEdo);
}

/* -------------------------------------------------------------------------
   7) Filtros: Estado / Acuífero + Buscador (geocodificador)
   ------------------------------------------------------------------------- */
const selEstado = document.getElementById('filter-estado');
const selAcuifero = document.getElementById('filter-acuifero');

function poblarFiltroEstado(){
  // Extraer SOLO los estados que realmente existen en datosPozos (pozos.geojson)
  // Usar nombres oficiales del mapeo creado al cargar los datos
  const nombres = [...new Set(datosPozos.map(f => f.properties.NOM_EDO_OFICIAL))].filter(Boolean).sort();
  nombres.forEach(nombreCorto => {
    const opt = document.createElement('option');
    // Usar el nombre oficial si existe en el mapeo, sino usar el corto
    const nombreOficial = window.mapeoNombresOficiales && window.mapeoNombresOficiales[nombreCorto] 
      ? window.mapeoNombresOficiales[nombreCorto]
      : nombreCorto;
    opt.value = nombreCorto;  // El value sigue siendo el nombre corto para filtros internos
    opt.textContent = nombreOficial;  // Pero mostramos el nombre oficial al usuario
    selEstado.appendChild(opt);
  });
}

selEstado.addEventListener('change', () => {
  const nombreEstado = selEstado.value;
  selAcuifero.innerHTML = '<option value="">Todos</option>';

  if (!nombreEstado){
    selAcuifero.disabled = true;
    map.setView(VISTA_INICIAL.center, VISTA_INICIAL.zoom, { animate: false });
    aplicarFiltros();
    return;
  }

  cargarGeografiaEstado(nombreEstado);

  // Zoom al estado seleccionado
  const featEstado = datosEstados.find(f => mismoEstado(f.properties.NOMGEO, nombreEstado));
  if (featEstado){
    const capaTmp = L.geoJSON(featEstado);
    map.fitBounds(capaTmp.getBounds(), { animate: false });
  }

  // Poblar acuíferos de ese estado SOLO extrayendo de datosPozos
  // Estrategia: Agrupar por NOMBRE del acuífero y mostrar solo la clave más baja de cada grupo
  const pozosDelEstado = datosPozos.filter(f => mismoEstado(f.properties.NOM_EDO_OFICIAL, nombreEstado));
  
  // Paso 1: Extraer nombres únicos de acuíferos
  const nombresUnicos = [...new Set(pozosDelEstado.map(p => p.properties.NOM_ACUIF).filter(Boolean))];
  
  // Paso 2: Para cada nombre, encontrar la clave más baja
  const acuiferosDelEstado = [];
  nombresUnicos.forEach(nombre => {
    // Encontrar todas las claves para este nombre
    const clavesParaNombre = pozosDelEstado
      .filter(p => p.properties.NOM_ACUIF === nombre)
      .map(p => p.properties.CVE_ACUIF_STR || p.properties.CVE_ACUIF)
      .filter(Boolean);
    
    // Usar la clave más baja (primera alfabéticamente)
    if (clavesParaNombre.length > 0) {
      const clavePrincipal = clavesParaNombre.sort()[0];
      acuiferosDelEstado.push({ nombre, clave: clavePrincipal });
    }
  });
  
  // Paso 3: Ordenar por clave
  acuiferosDelEstado.sort((a, b) => a.clave.localeCompare(b.clave));

  if (acuiferosDelEstado.length){
    selAcuifero.disabled = false;
    acuiferosDelEstado.forEach(acuif => {
      const opt = document.createElement('option');
      opt.value = acuif.clave;
      opt.textContent = `${acuif.clave} — ${acuif.nombre}`;
      selAcuifero.appendChild(opt);
    });
  } else {
    selAcuifero.disabled = true;
  }

  aplicarFiltros();
});

selAcuifero.addEventListener('change', () => {
  const clave = selAcuifero.value;
  if (clave){
    // Hacer zoom a los pozos que pertenecen a este acuífero en el estado actual
    const nombreEstado = selEstado.value;
    const pozosDelAcuifero = datosPozos.filter(f => 
      (f.properties.CVE_ACUIF_STR === clave || f.properties.CVE_ACUIF === clave) &&
      mismoEstado(f.properties.NOM_EDO_OFICIAL, nombreEstado)
    );
    if (pozosDelAcuifero.length){
      const capaTmp = L.geoJSON({
        type: 'FeatureCollection',
        features: pozosDelAcuifero
      });
      map.fitBounds(capaTmp.getBounds(), { animate: false });
    }
  }
  aplicarFiltros();
});

function aplicarFiltros(){
  const nombreEstado = selEstado.value;
  const claveSeleccionada = selAcuifero.value;
  const tiposActivos = [...document.querySelectorAll('.pozo-tipo:checked')].map(cb => cb.value);
  
  // Obtener el nombre del acuífero basado en la clave seleccionada
  let nombreAcuiferoSeleccionado = '';
  if (claveSeleccionada){
    const pozosConClave = datosPozos.find(f => 
      (f.properties.CVE_ACUIF_STR === claveSeleccionada || f.properties.CVE_ACUIF === claveSeleccionada)
    );
    if (pozosConClave) {
      nombreAcuiferoSeleccionado = pozosConClave.properties.NOM_ACUIF;
    }
  }

  capaPozos.eachLayer(layer => {
    const p = layer.feature.properties;
    let visible = true;
    if (nombreEstado && !mismoEstado(p.NOM_EDO_OFICIAL, nombreEstado)) visible = false;
    // Filtrar por nombre de acuífero si está seleccionado, para incluir todas sus subdivisiones
    if (nombreAcuiferoSeleccionado && p.NOM_ACUIF !== nombreAcuiferoSeleccionado) visible = false;
    if (!tiposActivos.includes(p.TIPO_INF || 'OTRO')) visible = false;

    const el = layer.getElement && layer.getElement();
    if (el) el.style.display = visible ? '' : 'none';
    layer._filtrado_visible = visible;
  });

  // resaltar acuífero elegido (recorremos la lista plana, ya que ahora los
  // polígonos viven repartidos en varias sub-capas, una por estado cargado)
  capasAcuiferoIndividuales.forEach(layer => {
    if (claveSeleccionada && layer.feature.properties.CLV_ACUI === claveSeleccionada){
      layer.setStyle(estiloAcuiferoSeleccionado);
    } else {
      layer.setStyle(estiloAcuiferos);
    }
  });

  const visibles = datosPozos.filter(f => {
    let ok = true;
    const p = f.properties;
    if (nombreEstado && !mismoEstado(p.NOM_EDO_OFICIAL, nombreEstado)) ok = false;
    if (nombreAcuiferoSeleccionado && p.NOM_ACUIF !== nombreAcuiferoSeleccionado) ok = false;
    if (!tiposActivos.includes(p.TIPO_INF || 'OTRO')) ok = false;
    return ok;
  });
  poblarTabla(visibles);
}

/* -------------------------------------------------------------------------
   Función para limpiar todos los filtros y restaurar estado inicial
   --------------------------------------------------------------------- */
function limpiarFiltros(){
  // 1. Limpiar selects de Estado y Acuífero
  selEstado.value = '';
  selAcuifero.value = '';
  selAcuifero.innerHTML = '<option value="">Todos</option>';
  selAcuifero.disabled = true;
  
  // 2. Limpiar input de búsqueda
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  
  // 3. Marcar TODOS los checkboxes de tipos de información
  document.querySelectorAll('.pozo-tipo').forEach(cb => {
    cb.checked = true;
  });
  
  // 4. Restaurar mapa a vista inicial
  map.setView(VISTA_INICIAL.center, VISTA_INICIAL.zoom, { animate: false });
  
  // 5. Aplicar filtros para actualizar tabla y capas
  aplicarFiltros();
  
  // 6. Mostrar todos los pozos en la tabla (sin filtros)
  poblarTabla(datosPozos);
}

// Event listener para el botón de limpiar filtros
document.getElementById('btn-limpiar-filtros').addEventListener('click', limpiarFiltros);

document.querySelectorAll('.pozo-tipo').forEach(cb => cb.addEventListener('change', aplicarFiltros));

document.getElementById('layer-acuiferos').addEventListener('change', (e) => {
  if (e.target.checked) map.addLayer(capaAcuiferos); else map.removeLayer(capaAcuiferos);
});
document.getElementById('layer-estados').addEventListener('change', (e) => {
  if (e.target.checked) map.addLayer(capaEstados); else map.removeLayer(capaEstados);
});
document.getElementById('layer-pozos').addEventListener('change', (e) => {
  if (e.target.checked) map.addLayer(capaPozos); else map.removeLayer(capaPozos);
});

/* Buscador por clave o nombre de acuífero */
function poblarBuscador(){
  const input = document.getElementById('search-input');
  const resultsDiv = document.getElementById('search-results');

  function buscar(){
    const q = normaliza(input.value);
    resultsDiv.innerHTML = '';
    if (q.length < 2) return;
    
    // Buscar en acuíferos únicos del dataset de pozos
    const acuiferosMap = new Map();
    datosPozos.forEach(f => {
      const nombre = f.properties.NOM_ACUIF;
      const clave = f.properties.CVE_ACUIF_STR || f.properties.CVE_ACUIF;
      const estado = f.properties.NOM_EDO_OFICIAL;
      if (nombre && !acuiferosMap.has(nombre)){
        acuiferosMap.set(nombre, { clave, nombre, estado });
      }
    });
    
    // Filtrar coincidencias
    const coincidencias = Array.from(acuiferosMap.values()).filter(acuif =>
      normaliza(acuif.clave).includes(q) || normaliza(acuif.nombre).includes(q)
    ).slice(0, 15);

    coincidencias.forEach(acuif => {
      const div = document.createElement('div');
      div.className = 'result-item';
      // Mostrar nombre oficial del estado si existe
      const nombreEstadoOficial = window.mapeoNombresOficiales && window.mapeoNombresOficiales[acuif.estado]
        ? window.mapeoNombresOficiales[acuif.estado]
        : acuif.estado;
      div.textContent = `${acuif.clave} — ${acuif.nombre} (${nombreEstadoOficial})`;
      div.addEventListener('click', () => {
        // Hacer zoom a los pozos de este acuífero
        const pozosDelAcuifero = datosPozos.filter(f => f.properties.NOM_ACUIF === acuif.nombre);
        if (pozosDelAcuifero.length){
          const capaTmp = L.geoJSON({
            type: 'FeatureCollection',
            features: pozosDelAcuifero
          });
          map.fitBounds(capaTmp.getBounds(), { animate: false });
        }
        // Establecer estado y acuífero
        selEstado.value = [...selEstado.options].find(o => o.value === acuif.estado)?.value || '';
        selEstado.dispatchEvent(new Event('change'));
        setTimeout(() => { 
          selAcuifero.value = acuif.clave; 
          selAcuifero.dispatchEvent(new Event('change')); 
        }, 50);
        resultsDiv.innerHTML = '';
        input.value = `${acuif.clave} — ${acuif.nombre}`;
      });
      resultsDiv.appendChild(div);
    });
  }
  input.addEventListener('input', buscar);
  document.getElementById('search-btn').addEventListener('click', buscar);
}

/* -------------------------------------------------------------------------
   8) Tabla de atributos (herramienta de visualización y selección de registros)
   ------------------------------------------------------------------------- */
const COLUMNAS_TABLA = ['CVE_LGJO','CVE_POZO','NOM_EDO_OFICIAL','AÑO','NOM_ACUIF','TIPO_INF','PROF_TOT_m','LONGITUD','LATITUD'];

function poblarTabla(features){
  const thead = document.querySelector('#attr-table thead');
  const tbody = document.querySelector('#attr-table tbody');
  thead.innerHTML = `<tr>${COLUMNAS_TABLA.map(c => `<th>${c}</th>`).join('')}</tr>`;
  tbody.innerHTML = '';

  features.forEach(f => {
    const p = { ...f.properties, LONGITUD: f.geometry.coordinates[0], LATITUD: f.geometry.coordinates[1] };
    const tr = document.createElement('tr');
    tr.dataset.uid = p.__uid;
    
    // Reemplazar NOM_EDO_OFICIAL con nombre oficial si existe en el mapeo
    const datosParaMostrar = { ...p };
    if (window.mapeoNombresOficiales && datosParaMostrar.NOM_EDO_OFICIAL && window.mapeoNombresOficiales[datosParaMostrar.NOM_EDO_OFICIAL]) {
      datosParaMostrar.NOM_EDO_OFICIAL = window.mapeoNombresOficiales[datosParaMostrar.NOM_EDO_OFICIAL];
    }
    
    tr.innerHTML = COLUMNAS_TABLA.map(c => `<td>${datosParaMostrar[c] !== null && datosParaMostrar[c] !== undefined ? datosParaMostrar[c] : ''}</td>`).join('');
    tr.addEventListener('click', () => {
      map.setView([f.geometry.coordinates[1], f.geometry.coordinates[0]], 14, { animate: false });
      // Un mismo CVE_LGJO puede tener muchos pozos con coordenadas distintas
      // (ver captura compartida: 10_0025 tiene decenas de puntos). Por eso
      // buscamos el marcador por __uid, que es único por pozo, y NO por
      // CVE_LGJO, que se repite. Así se abre el popup del punto exacto que
      // el usuario clickeó en la tabla, no el último que Leaflet recorra.
      const layerDelPunto = capaPozos.getLayers().find(l => l.feature.properties.__uid === p.__uid);
      if (layerDelPunto) layerDelPunto.openPopup();
      resaltarFila(p.__uid);
      resaltarPuntoEnMapa(f.geometry.coordinates[1], f.geometry.coordinates[0]);
    });
    tbody.appendChild(tr);
  });
  document.getElementById('attr-count').textContent = features.length;
}

function resaltarFila(uid){
  const uidStr = String(uid);
  document.querySelectorAll('#attr-table tbody tr').forEach(tr => {
    tr.classList.toggle('row-selected', tr.dataset.uid === uidStr);
  });
}
function seleccionarFilaTabla(uid){
  resaltarFila(uid);
  const fila = document.querySelector(`#attr-table tbody tr[data-uid="${uid}"]`);
  if (fila) fila.scrollIntoView({ block: 'center' });
}

document.getElementById('attr-table-toggle').addEventListener('click', () => {
  const sec = document.getElementById('attr-table-section');
  sec.classList.toggle('collapsed');
  document.getElementById('attr-table-toggle').textContent = sec.classList.contains('collapsed') ? '▸' : '▾';
  // el mapa debe enterarse de que su contenedor cambió de alto (espera a que
  // termine la transición CSS de 0.2s definida en .attr-table-section)
  setTimeout(() => map.invalidateSize(), 220);
});

/* -------------------------------------------------------------------------
   9) Panel lateral: mostrar/ocultar y modal "Acerca de"
   ------------------------------------------------------------------------- */
document.getElementById('panel-toggle').addEventListener('click', () => {
  document.getElementById('side-panel').classList.toggle('collapsed');
  setTimeout(() => map.invalidateSize(), 210);
});
document.getElementById('btn-info').addEventListener('click', () => {
  document.getElementById('modal-info').style.display = 'flex';
});
document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-info').style.display = 'none';
});

/* -------------------------------------------------------------------------
   10) Herramienta de descarga de información
   ------------------------------------------------------------------------- */
function featuresVisiblesActuales(){
  const nombreEstado = selEstado.value;
  const claveSeleccionada = selAcuifero.value;
  const tiposActivos = [...document.querySelectorAll('.pozo-tipo:checked')].map(cb => cb.value);
  
  // Obtener el nombre del acuífero basado en la clave seleccionada
  let nombreAcuiferoSeleccionado = '';
  if (claveSeleccionada){
    const pozosConClave = datosPozos.find(f => 
      (f.properties.CVE_ACUIF_STR === claveSeleccionada || f.properties.CVE_ACUIF === claveSeleccionada)
    );
    if (pozosConClave) {
      nombreAcuiferoSeleccionado = pozosConClave.properties.NOM_ACUIF;
    }
  }
  
  return datosPozos.filter(f => {
    const p = f.properties;
    if (nombreEstado && !mismoEstado(p.NOM_EDO_OFICIAL, nombreEstado)) return false;
    if (nombreAcuiferoSeleccionado && p.NOM_ACUIF !== nombreAcuiferoSeleccionado) return false;
    if (!tiposActivos.includes(p.TIPO_INF || 'OTRO')) return false;
    return true;
  });
}

document.getElementById('download-excel').addEventListener('click', () => {
  const feats = featuresVisiblesActuales();
  const filas = feats.map(f => ({ ...f.properties, LONGITUD: f.geometry.coordinates[0], LATITUD: f.geometry.coordinates[1] }));
  const csv = Papa.unparse(filas);
  descargarBlob('\ufeff' + csv, 'pozos_geoinbaseha.csv', 'text/csv;charset=utf-8;');
});

document.getElementById('download-geojson').addEventListener('click', () => {
  const feats = featuresVisiblesActuales();
  const fc = { type: 'FeatureCollection', features: feats };
  descargarBlob(JSON.stringify(fc), 'pozos_geoinbaseha.geojson', 'application/geo+json');
});

document.getElementById('download-simbologia').addEventListener('click', () => {
  const filas = Object.entries(SIMBOLOGIA).map(([tipo, def]) => ({
    tipo_informacion: tipo, etiqueta: def.etiqueta, color_hex: def.color
  }));
  const csv = Papa.unparse(filas);
  descargarBlob('\ufeff' + csv, 'simbologia_geoinbaseha.csv', 'text/csv;charset=utf-8;');
});

document.getElementById('download-diccionario').addEventListener('click', () => {
  window.open('data/diccionario_datos.csv', '_blank');
});
