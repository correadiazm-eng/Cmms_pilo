# GMAO Intelligence

Aplicación estática para analizar órdenes de trabajo CMMS/GMAO en GitHub Pages. No utiliza un servidor ni envía los datos a terceros. Incluye un dataset de ejemplo y permite cargar varios archivos CSV o Excel desde el equipo.

## Uso local

Abre `index.html` desde GitHub Pages o sirve la carpeta con un servidor estático local. La carga automática del ejemplo necesita un origen HTTP; al abrir `index.html` directamente con `file://`, usa **Cargar dataset** para seleccionar un CSV o Excel.

## Publicación en GitHub Pages

Publica el contenido de `webapp/` como raíz del sitio o configura GitHub Pages para servir esa carpeta. El análisis de CSV y las gráficas funcionan sin dependencias externas. La lectura de archivos Excel usa SheetJS desde jsDelivr; si el CDN no está disponible, se puede cargar el mismo dataset en formato CSV.

## Datos y resultados

- Columnas mínimas: `OT`, `Equipo` y `Tipo_mantenimiento`.
- Se aceptan CSV UTF-8 delimitados por coma, punto y coma o tabulación, y archivos `.xlsx` / `.xls` (primera hoja).
- Los filtros de tipo y fecha actualizan los KPI y gráficos.
- El MTTR usa órdenes correctivas cerradas con inicio y fin válidos; usa `Tiempo_reparacion_h` como alternativa cuando las fechas no están disponibles.
- MTBF y disponibilidad no se estiman porque requieren horas reales de operación.
- **Exportar informe PDF** abre el diálogo de impresión del navegador. Selecciona **Guardar como PDF** para generar el documento con el resumen, los gráficos de Pareto, MTTR y Jack-Knife del análisis actual.
