from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import pandas as pd
import json

app = FastAPI(title="API SICAR Áncash")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def cargar_geojson(ruta_archivo):
    with open(ruta_archivo, 'r', encoding='utf-8') as archivo:
        return json.load(archivo)

# --- 1. CARGAR MAPA BASE Y EXTRAER LISTA OFICIAL DE ÁNCASH ---
geo_provincias = cargar_geojson("limite_provincias.geojson")
# Sacamos los nombres exactos de las provincias del mapa y los ponemos en mayúsculas
provincias_ancash_oficiales = [f['properties']['PROVINCIA'].strip().upper() for f in geo_provincias['features'] if 'PROVINCIA' in f['properties']]

# --- 2. CARGAR Y LIMPIAR LA BASE DE DATOS (CSV) ---
df = pd.read_csv("Datos_Visor_Ancash.csv", low_memory=False)
df = df.fillna("") 

# LIMPIEZA EXTREMA: Todo a mayúsculas para unificar opciones (Huaraz = HUARAZ)
df['Tipo_Dataset'] = df['Tipo_Dataset'].astype(str).str.strip().str.upper()
df['Cuenca'] = df['Cuenca'].astype(str).str.strip().str.upper()
df['Provincia'] = df['Provincia'].astype(str).str.strip().str.upper()
df['Distrito'] = df['Distrito'].astype(str).str.strip().str.upper()

# CERCO GEOGRÁFICO: Conservamos SOLO los registros cuyas provincias existan en el mapa de Áncash
df = df[df['Provincia'].isin(provincias_ancash_oficiales)]

# --- RUTAS BÁSICAS ---
@app.get("/")
def ruta_principal(): return {"mensaje": "Servidor activo"}

@app.get("/api/poligonos/{capa}")
def obtener_poligonos(capa: str):
    if capa == "ancash": return cargar_geojson("limite_ancash.geojson")
    elif capa == "cuencas": return cargar_geojson("limite_cuencas.geojson")
    elif capa == "provincias": return geo_provincias # Usamos el que ya cargamos arriba
    elif capa == "distritos": return cargar_geojson("limite_distritos.geojson")
    return {"error": "Capa no encontrada"}

@app.get("/api/filtros")
def obtener_filtros():
    # Las listas ahora saldrán limpias, únicas y exclusivamente de Áncash
    return {
        "tipos": sorted([str(t) for t in df['Tipo_Dataset'].unique() if t != ""]),
        "cuencas": sorted([str(c) for c in df['Cuenca'].unique() if c != ""]),
        "provincias": sorted([str(p) for p in df['Provincia'].unique() if p != ""]),
        "distritos": sorted([str(d) for d in df['Distrito'].unique() if d != ""])
    }

# --- RUTA: FILTRO EN CASCADA ---
class FiltrosCascada(BaseModel):
    cuencas: List[str]
    provincias: List[str]

@app.post("/api/cascada")
def obtener_cascada(datos: FiltrosCascada):
    df_temp = df.copy()
    
    # Como todo ya está en mayúsculas, el filtrado ahora es mucho más rápido
    if datos.cuencas:
        cuencas_upper = [c.strip().upper() for c in datos.cuencas]
        df_temp = df_temp[df_temp['Cuenca'].isin(cuencas_upper)]
    
    provincias_disp = sorted([str(p) for p in df_temp['Provincia'].unique() if p != ""])

    if datos.provincias:
        provs_upper = [p.strip().upper() for p in datos.provincias]
        df_temp = df_temp[df_temp['Provincia'].isin(provs_upper)]
        
    distritos_disp = sorted([str(d) for d in df_temp['Distrito'].unique() if d != ""])
    
    return {"provincias": provincias_disp, "distritos": distritos_disp}

# --- RUTA: FILTRADO MATEMÁTICO DE PUNTOS ---
class FiltrosWeb(BaseModel):
    tipo: List[str]
    cuenca: List[str]
    provincia: List[str]
    distrito: List[str]

@app.post("/api/filtrar")
def filtrar_datos(filtros: FiltrosWeb):
    df_filt = df.copy()
    
    if filtros.tipo:
        tipos_upper = [t.strip().upper() for t in filtros.tipo]
        df_filt = df_filt[df_filt['Tipo_Dataset'].isin(tipos_upper)]
        
    if filtros.cuenca:
        cuencas_upper = [c.strip().upper() for c in filtros.cuenca]
        df_filt = df_filt[df_filt['Cuenca'].isin(cuencas_upper)]
        
    if filtros.provincia:
        provs_upper = [p.strip().upper() for p in filtros.provincia]
        df_filt = df_filt[df_filt['Provincia'].isin(provs_upper)]
        
    if filtros.distrito:
        dists_upper = [d.strip().upper() for d in filtros.distrito]
        df_filt = df_filt[df_filt['Distrito'].isin(dists_upper)]
    
    cantidad_total = len(df_filt)
    # ELIMINAMOS EL LÍMITE: Ahora enviamos toda la data para que el Cluster la agrupe
    puntos_completos = df_filt.to_dict(orient="records")
    return {"cantidad_total": cantidad_total, "puntos": puntos_completos}