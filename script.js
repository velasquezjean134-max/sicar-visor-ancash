// --- 1. INICIALIZAR MAPA Y PANELES ESTRICTOS (Z-INDEX) ---
var mapa = L.map('mapa', { zoomControl: false }).setView([-9.52, -77.52], 8);
L.control.zoom({ position: 'bottomright' }).addTo(mapa);

var mapaClaro = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CartoDB' });
var satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
var mapaCalles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' });

mapaClaro.addTo(mapa);
L.control.layers({ "Mapa Base (Claro)": mapaClaro, "Satélite": satelite, "Mapa de Calles": mapaCalles }, null, {position: 'topright'}).addTo(mapa);

// Creación de Paneles de Cristal (El número mayor va arriba)
mapa.createPane('paneBase');       mapa.getPane('paneBase').style.zIndex = 390; 
mapa.createPane('paneCuencas');    mapa.getPane('paneCuencas').style.zIndex = 400; 
mapa.createPane('paneProvincias'); mapa.getPane('paneProvincias').style.zIndex = 410; 
mapa.createPane('paneDistritos');  mapa.getPane('paneDistritos').style.zIndex = 420; 
mapa.createPane('panePuntos');     mapa.getPane('panePuntos').style.zIndex = 430; 

var capaCuencas = L.layerGroup().addTo(mapa);
var capaProvincias = L.layerGroup().addTo(mapa);
var capaDistritos = L.layerGroup().addTo(mapa);

// DOS CAPAS PARA LOS PUNTOS: Una Inteligente (Cluster) y una Individual
var capaPuntosCluster = L.markerClusterGroup({
    chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true, clusterPane: 'panePuntos'
});
var capaPuntosIndividual = L.layerGroup();

// Cargar el límite regional de Áncash al fondo
fetch('http://127.0.0.1:8000/api/poligonos/ancash')
    .then(r => r.json())
    .then(geo => L.geoJSON(geo, { pane: 'paneBase', interactive: false, style: { color: "#333333", weight: 2, dashArray: "5, 5", fillOpacity: 0 } }).addTo(mapa))
    .catch(e => console.error("Error cargando Áncash:", e));

// --- 2. INTERFAZ: TOAST Y PANELES ---
setTimeout(() => { const t = document.getElementById('toast-bienvenida'); if(t) { t.style.opacity = '0'; setTimeout(() => t.style.display = 'none', 500); } }, 2500);

const panelFiltros = document.getElementById('panel-filtros'), btnCerrar = document.getElementById('btn-cerrar-panel'), btnAbrir = document.getElementById('btn-abrir-panel');
if(btnCerrar && btnAbrir && panelFiltros) { btnCerrar.addEventListener('click', () => { panelFiltros.style.display = 'none'; btnAbrir.style.display = 'block'; }); btnAbrir.addEventListener('click', () => { panelFiltros.style.display = 'flex'; btnAbrir.style.display = 'none'; }); }
const panelDetalles = document.getElementById('panel-detalles'), btnCerrarDetalles = document.getElementById('btn-cerrar-detalles');
if(btnCerrarDetalles) btnCerrarDetalles.addEventListener('click', () => { panelDetalles.style.display = 'none'; });

// Lógica de los desplegables tipo Checklist
document.querySelectorAll('.dropdown-check-list .anchor').forEach(anchor => { anchor.onclick = function() { document.querySelectorAll('.dropdown-check-list').forEach(dd => { if (dd !== this.parentElement) dd.classList.remove('visible'); }); this.parentElement.classList.toggle('visible'); } });
document.addEventListener('click', function(e) { if (!e.target.closest('.dropdown-check-list')) document.querySelectorAll('.dropdown-check-list').forEach(dd => dd.classList.remove('visible')); });

// --- 3. LÓGICA DE FILTROS Y CASCADA ---
function getMarcados(id) { return Array.from(document.querySelectorAll(`#${id} input[type="checkbox"]:checked`)).map(cb => cb.value); }
function actualizarTextoAnchor(id) { const m = getMarcados(id); const c = document.getElementById(id); if(c) { const a = c.parentElement.querySelector('.anchor'); if(a) a.innerText = m.length === 0 ? "Seleccione opciones..." : (m.length === 1 ? m[0] : `${m.length} seleccionados`); } }

function llenarChecklist(id, lista) {
    const contenedor = document.getElementById(id);
    if(!contenedor) return;
    contenedor.innerHTML = ''; 
    lista.forEach(op => { let li = document.createElement('li'); li.innerHTML = `<label><input type="checkbox" value="${op}"> ${op}</label>`; contenedor.appendChild(li); });
    contenedor.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.addEventListener('change', async () => { actualizarTextoAnchor(id); if (id === 'filtro-cuenca') await actualizarCascada('cuenca'); else if (id === 'filtro-provincia') await actualizarCascada('provincia'); aplicarFiltros(); }); });
    actualizarTextoAnchor(id);
}

// Carga inicial de filtros
fetch('http://127.0.0.1:8000/api/filtros').then(r => r.json()).then(datos => {
    llenarChecklist('filtro-tipo', datos.tipos); llenarChecklist('filtro-cuenca', datos.cuencas); llenarChecklist('filtro-provincia', datos.provincias); llenarChecklist('filtro-distrito', datos.distritos);
    aplicarFiltros(); 
});

async function actualizarCascada(origen) {
    const cuencas = getMarcados('filtro-cuenca'); let provs = getMarcados('filtro-provincia');
    if (origen === 'cuenca') provs = []; 
    try {
        const r = await fetch('http://127.0.0.1:8000/api/cascada', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cuencas: cuencas, provincias: provs }) });
        const datos = await r.json();
        if (origen === 'cuenca') llenarChecklist('filtro-provincia', datos.provincias);
        llenarChecklist('filtro-distrito', datos.distritos);
    } catch (e) { console.error("Error en cascada:", e); }
}

// --- 4. MOTOR DE BÚSQUEDA Y DIBUJO ---
let datosGlobalesCSV = []; 

// DICCIONARIO DE ICONOS Y COLORES POR TIPO DE INFORMACIÓN
const configSimbologia = {
    "AREAS DEGRADADAS POR RRSS": { icono: "fa-dumpster", color: "#8B4513", titulo: "Áreas Degradadas (RRSS)" }, 
    "DERECHOS DE USO DE AGUA": { icono: "fa-hand-holding-droplet", color: "#00a8ff", titulo: "Derechos de Uso de Agua" }, 
    "FUENTES CONTAMINANTES": { icono: "fa-industry", color: "#8e44ad", titulo: "Fuentes Contaminantes" }, 
    "INFRAESTRUCTURA DE RRSS": { icono: "fa-recycle", color: "#27ae60", titulo: "Infraestructura RRSS" }, 
    "RED DE MONITOREO EN MAR": { icono: "fa-anchor", color: "#2c3e50", titulo: "Monitoreo en Mar" }, 
    "RED DE MONITOREO": { icono: "fa-flask", color: "#2980b9", titulo: "Red de Monitoreo" }, 
    "SITIOS IMPACTADOS CON DAR": { icono: "fa-droplet", color: "#d62728", titulo: "Sitios Impactados (DAR)" } 
};

function aplicarFiltros() {
    const seleccion = { tipo: getMarcados('filtro-tipo'), cuenca: getMarcados('filtro-cuenca'), provincia: getMarcados('filtro-provincia'), distrito: getMarcados('filtro-distrito') };
    const txtRes = document.getElementById('contador-resultados');
    
    // SEGURO CONTRA MAPA SATURADO: Exigir al menos un filtro
    if (seleccion.tipo.length === 0 && seleccion.cuenca.length === 0 && seleccion.provincia.length === 0 && seleccion.distrito.length === 0) {
        capaCuencas.clearLayers(); capaProvincias.clearLayers(); capaDistritos.clearLayers(); 
        capaPuntosCluster.clearLayers(); capaPuntosIndividual.clearLayers();
        if(txtRes) txtRes.innerHTML = "Resultados: 0 puntos (Seleccione al menos un filtro).";
        if(document.getElementById('btn-descargar-csv')) document.getElementById('btn-descargar-csv').style.display = 'none';
        if(document.getElementById('leyenda-mapa')) document.getElementById('leyenda-mapa').style.display = 'none';
        datosGlobalesCSV = [];
        return; 
    }

    if(txtRes) txtRes.innerHTML = "Resultados: Buscando...";

    fetch('http://127.0.0.1:8000/api/filtrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seleccion) })
    .then(r => r.json()).then(datos => {
        
        // Limpiamos capas previas
        capaCuencas.clearLayers(); capaProvincias.clearLayers(); capaDistritos.clearLayers(); 
        capaPuntosCluster.clearLayers(); capaPuntosIndividual.clearLayers();

        if(txtRes) txtRes.innerHTML = `Resultados: <strong>${datos.cantidad_total}</strong> puntos encontrados.`;
        datosGlobalesCSV = datos.puntos; 
        
        if(document.getElementById('btn-descargar-csv')) document.getElementById('btn-descargar-csv').style.display = datos.cantidad_total > 0 ? 'block' : 'none';

        // LEYENDA DINÁMICA DE ICONOS
        let tiposPresentes = new Set();
        datos.puntos.forEach(p => tiposPresentes.add(String(p.Tipo_Dataset).toUpperCase().trim()));
        let leyendaHtml = "";
        tiposPresentes.forEach(tipo => {
            let config = configSimbologia[tipo];
            if (config) leyendaHtml += `<div class="leyenda-item"><i class="fa-solid ${config.icono}" style="color:${config.color}; width:20px; text-align:center; font-size:14px; margin-right:5px; text-shadow: 1px 1px 1px rgba(0,0,0,0.3);"></i> ${config.titulo}</div>`;
        });

        // LECTURA DE SLIDERS Y DIBUJO DE POLÍGONOS
        const opC = document.getElementById('slider-cuenca') ? parseFloat(document.getElementById('slider-cuenca').value) : 0.15;
        const opP = document.getElementById('slider-provincia') ? parseFloat(document.getElementById('slider-provincia').value) : 0.15;
        const opD = document.getElementById('slider-distrito') ? parseFloat(document.getElementById('slider-distrito').value) : 0.25;

        let polyLegend = "";
        if (seleccion.distrito.length > 0) {
            polyLegend += `<div class="leyenda-item"><div class="leyenda-poly" style="background:#2ca02c; border-color:#2ca02c;"></div> Distritos</div>`;
            fetch('http://127.0.0.1:8000/api/poligonos/distritos').then(r => r.json()).then(geo => { L.geoJSON(geo, { pane: 'paneDistritos', interactive: false, filter: (f) => f.properties.DISTRITO && seleccion.distrito.map(d=>d.toUpperCase().trim()).includes(f.properties.DISTRITO.toUpperCase().trim()), style: { color: "#2ca02c", weight: 2, fillOpacity: opD } }).addTo(capaDistritos); });
        }
        if (seleccion.provincia.length > 0) {
            polyLegend += `<div class="leyenda-item"><div class="leyenda-poly" style="background:#ff7f0e; border-color:#ff7f0e;"></div> Provincias</div>`;
            fetch('http://127.0.0.1:8000/api/poligonos/provincias').then(r => r.json()).then(geo => { L.geoJSON(geo, { pane: 'paneProvincias', interactive: false, filter: (f) => f.properties.PROVINCIA && seleccion.provincia.map(p=>p.toUpperCase().trim()).includes(f.properties.PROVINCIA.toUpperCase().trim()), style: { color: "#ff7f0e", weight: 2, fillOpacity: opP } }).addTo(capaProvincias); });
        }
        if (seleccion.cuenca.length > 0) {
            polyLegend += `<div class="leyenda-item"><div class="leyenda-poly" style="background:#0068c9; border-color:#0068c9;"></div> Cuencas</div>`;
            fetch('http://127.0.0.1:8000/api/poligonos/cuencas').then(r => r.json()).then(geo => { L.geoJSON(geo, { pane: 'paneCuencas', interactive: false, filter: (f) => f.properties.NOMBRE && seleccion.cuenca.map(c=>c.toUpperCase().trim()).includes(f.properties.NOMBRE.toUpperCase().trim()), style: { color: "#0068c9", weight: 2, fillOpacity: opC } }).addTo(capaCuencas); });
        }

        // MOSTRAR U OCULTAR LEYENDA
        const leyendaDiv = document.getElementById('leyenda-mapa');
        if(leyendaDiv) {
            if (polyLegend !== "") leyendaHtml = polyLegend + (leyendaHtml ? `<hr style="margin:5px 0; border-top:1px solid #ccc;">` + leyendaHtml : "");
            if (leyendaHtml !== "") { document.getElementById('leyenda-contenido').innerHTML = leyendaHtml; leyendaDiv.style.display = 'block'; } else { leyendaDiv.style.display = 'none'; }
        }

        // LECTURA DEL INTERRUPTOR DE AGRUPAMIENTO
        const toggleCluster = document.getElementById('toggle-cluster');
        const usarCluster = toggleCluster ? toggleCluster.checked : true;

        if (usarCluster) {
            if (!mapa.hasLayer(capaPuntosCluster)) mapa.addLayer(capaPuntosCluster);
            if (mapa.hasLayer(capaPuntosIndividual)) mapa.removeLayer(capaPuntosIndividual);
        } else {
            if (!mapa.hasLayer(capaPuntosIndividual)) mapa.addLayer(capaPuntosIndividual);
            if (mapa.hasLayer(capaPuntosCluster)) mapa.removeLayer(capaPuntosCluster);
        }

        let marcadores = [];

        // CREACIÓN DE LOS PUNTOS CON SUS ICONOS FÓNTAWESOME
        datos.puntos.forEach(punto => {
            if (punto.Y !== "" && punto.X !== "") {
                let tipo = String(punto.Tipo_Dataset).toUpperCase().trim();
                let configuracion = configSimbologia[tipo];
                let marcador;

                if (configuracion) {
                    let iconoHtml = L.divIcon({ html: `<i class="fa-solid ${configuracion.icono}" style="color: ${configuracion.color}; font-size: 16px; text-shadow: 1px 1px 2px rgba(0,0,0,0.6);"></i>`, className: '', iconSize: [16, 16], iconAnchor: [8, 16] });
                    marcador = L.marker([punto.Y, punto.X], { icon: iconoHtml, pane: 'panePuntos' });
                } else {
                    marcador = L.circleMarker([punto.Y, punto.X], { pane: 'panePuntos', radius: 5, color: "#333", fillOpacity: 0.8, weight: 1 });
                }

                marcador.on('click', () => abrirPanelDetalles(punto));
                marcadores.push(marcador);
            }
        });

        // ENVIAR PUNTOS A LA CAPA SELECCIONADA
        if (usarCluster) {
            capaPuntosCluster.addLayers(marcadores);
        } else {
            marcadores.forEach(m => m.addTo(capaPuntosIndividual));
        }

    }).catch(e => console.error("Error aplicando filtros:", e));
}

// Evento del interruptor para redibujar instantáneamente
document.getElementById('toggle-cluster')?.addEventListener('change', aplicarFiltros);

// --- 5. LOGICA DEL PANEL DE DETALLES Y LOGOS INSTITUCIONALES ---

// Función estricta para asignar el logo según el Tipo de Información
function obtenerLogoEntidad(tipoDataset) {
    let tipo = String(tipoDataset).toUpperCase().trim();

    if (tipo === "AREAS DEGRADADAS POR RRSS") return "logo_oefa.png";
    if (tipo === "DERECHOS DE USO DE AGUA") return "logo_ana.png";
    if (tipo === "FUENTES CONTAMINANTES") return "logo_ana.png";
    if (tipo === "INFRAESTRUCTURA DE RRSS") return "logo_oefa.png";
    if (tipo === "RED DE MONITOREO") return "logo_ana.png";
    if (tipo === "RED DE MONITOREO EN MAR") return "logo_imarpe.png";
    if (tipo === "SITIOS IMPACTADOS CON DAR") return "logo_inaigem.png";
    
    return "logo_default.png"; 
}

// --- FUNCIÓN QUE CONSTRUYE EL PANEL DERECHO ---
function abrirPanelDetalles(punto) {
    if(!panelDetalles) return;
    
    panelDetalles.style.display = 'flex'; 
    let rutaLogo = obtenerLogoEntidad(punto.Tipo_Dataset);

    // 1. Logo más grande (max-height: 90px) y campos con iconos profesionales (FontAwesome)
    let htmlInfo = `
        <div style="text-align: center; margin-bottom: 15px; background-color: #f9f9f9; padding: 10px; border-radius: 5px;">
            <img src="${rutaLogo}" alt="Logo Institucional" style="max-height: 90px; max-width: 100%; object-fit: contain;" onerror="this.style.display='none'; this.parentNode.style.display='none';">
        </div>
        
        <p><i class="fa-solid fa-layer-group" style="color: #0182c7; width: 20px; text-align: center;"></i> <strong>Tipo:</strong> ${punto.Tipo_Dataset}</p>
        <p><i class="fa-solid fa-building-columns" style="color: #0182c7; width: 20px; text-align: center;"></i> <strong>Entidad:</strong> ${punto.Entidad}</p>
        <p><i class="fa-solid fa-water" style="color: #0182c7; width: 20px; text-align: center;"></i> <strong>Cuenca:</strong> ${punto.Cuenca}</p>
        <p><i class="fa-solid fa-map-location-dot" style="color: #0182c7; width: 20px; text-align: center;"></i> <strong>Provincia:</strong> ${punto.Provincia}</p>
        <p><i class="fa-solid fa-location-dot" style="color: #0182c7; width: 20px; text-align: center;"></i> <strong>Distrito:</strong> ${punto.Distrito}</p>
        <hr style="margin: 15px 0; border-top: 1px solid #ccc;">
        
        <details style="cursor: pointer;">
            <summary style="font-weight: bold; color: #0182c7; font-size: 15px; outline: none; margin-bottom: 10px;">
                Información Específica <i class="fa-solid fa-caret-down" style="margin-left: 5px;"></i>
            </summary>
            
            <div style="max-height: 250px; overflow-y: auto; padding: 10px; border: 1px solid #eee; border-radius: 5px; background-color: #fcfcfc;">
    `;
    
    // 3. Agregamos el resto de las columnas dinámicas dentro del contenedor con scroll
    const excluidos = ['Tipo_Dataset', 'Entidad', 'Cuenca', 'Provincia', 'Distrito', 'X', 'Y'];
    let hayDatosExtra = false;
    
    for (let col in punto) { 
        if (!excluidos.includes(col) && punto[col] !== "" && punto[col] !== null) {
            htmlInfo += `<p style="margin-bottom: 8px; font-size: 13px; border-bottom: 1px solid #f0f0f0; padding-bottom: 4px;"><strong>${col}:</strong> ${punto[col]}</p>`; 
            hayDatosExtra = true;
        }
    }
    
    if (!hayDatosExtra) {
        htmlInfo += `<p style="font-size: 13px; color: #777;">No hay datos adicionales disponibles.</p>`;
    }
    
    htmlInfo += `
            </div>
        </details>
    `;
    
    document.getElementById('contenido-detalles').innerHTML = htmlInfo;
}

// --- 6. EVENTOS DE INTERFAZ (SLIDERS Y DESCARGA CSV) ---
document.getElementById('slider-cuenca')?.addEventListener('input', (e) => { capaCuencas.eachLayer(l => { if(l.setStyle) l.setStyle({fillOpacity: e.target.value}); }); });
document.getElementById('slider-provincia')?.addEventListener('input', (e) => { capaProvincias.eachLayer(l => { if(l.setStyle) l.setStyle({fillOpacity: e.target.value}); }); });
document.getElementById('slider-distrito')?.addEventListener('input', (e) => { capaDistritos.eachLayer(l => { if(l.setStyle) l.setStyle({fillOpacity: e.target.value}); }); });

document.getElementById('btn-descargar-csv')?.addEventListener('click', () => {
    if (datosGlobalesCSV.length === 0) return;
    
    // Limpieza inteligente: exportar solo columnas con datos
    let colsActivas = new Set();
    datosGlobalesCSV.forEach(f => { for(let c in f) if(f[c] !== null && f[c] !== "") colsActivas.add(c); });
    const headers = Array.from(colsActivas);
    
    let csv = "\uFEFF" + headers.join(",") + "\n";
    datosGlobalesCSV.forEach(r => { 
        csv += headers.map(h => `"${(r[h] == null ? "" : String(r[h])).replace(/"/g, '""')}"`).join(",") + "\n"; 
    });
    
    const link = document.createElement("a"); 
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); 
    link.download = "SICAR_Ancash_Filtrado.csv"; 
    link.click();
});