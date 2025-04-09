/**
 * Procesador de Documentos para CAG
 * 
 * Este módulo maneja el procesamiento y extracción de información de archivos
 * subidos por el usuario, como PDFs, documentos de texto, hojas de cálculo, etc.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Directorio para almacenamiento de documentos
const DOCS_DIR = path.join(__dirname, 'data', 'documents');

// Variables para módulos opcionales
let pdfParse, mammoth, csvParse, xlsx;

// Tamaño máximo de segmento para análisis de texto
const MAX_SEGMENT_SIZE = 2000;
// Número máximo de palabras clave a extraer
const MAX_KEY_CONCEPTS = 15;
// Tamaño máximo de archivo permitido (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Máximo de caracteres para procesamiento de texto
const MAX_PROCESS_LENGTH = 500000;

/**
 * Verifica e inicializa las dependencias
 */
function init() {
    try {
        // Crear directorio de documentos si no existe
        if (!fs.existsSync(DOCS_DIR)) {
            fs.mkdirSync(DOCS_DIR, { recursive: true });
            console.log('DocumentProcessor: Directorio de documentos creado');
        }
        
        // Verificar dependencias opcionales
        try {
            pdfParse = require('pdf-parse');
            console.log('DocumentProcessor: Soporte para PDF habilitado');
        } catch (err) {
            console.log('DocumentProcessor: El procesamiento de PDF no está disponible');
        }
        
        try {
            mammoth = require('mammoth');
            console.log('DocumentProcessor: Soporte para DOCX habilitado');
        } catch (err) {
            console.log('DocumentProcessor: El procesamiento de DOCX no está disponible');
        }
        
        try {
            csvParse = require('csv-parse');
            console.log('DocumentProcessor: Soporte para CSV habilitado');
        } catch (err) {
            console.log('DocumentProcessor: El procesamiento de CSV no está disponible');
        }
        
        try {
            xlsx = require('xlsx');
            console.log('DocumentProcessor: Soporte para Excel habilitado');
        } catch (err) {
            console.log('DocumentProcessor: El procesamiento de Excel no está disponible');
        }
        
        console.log('DocumentProcessor: Inicializado correctamente');
    } catch (error) {
        console.error('DocumentProcessor: Error de inicialización:', error);
    }
}

/**
 * Verifica las dependencias disponibles para procesamiento de documentos
 * @returns {Object} Estado de las dependencias
 */
function checkDependencies() {
    return {
        pdfExtraction: !!pdfParse,
        docxExtraction: !!mammoth,
        csvParsing: !!csvParse,
        excelExtraction: !!xlsx
    };
}

/**
 * Procesa un documento y extrae su contenido y metadatos
 * @param {Buffer} fileBuffer - Buffer del archivo
 * @param {string} fileName - Nombre original del archivo
 * @param {string} conversationId - ID de la conversación asociada
 * @returns {Promise<Object>} Información del documento procesado
 */
async function processDocument(fileBuffer, fileName, conversationId) {
    try {
        if (fileBuffer.length > MAX_FILE_SIZE) {
            throw new Error(`El archivo excede el tamaño máximo permitido de ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
        }
        
        // Crear directorio para la conversación si no existe
        const conversationDocsDir = path.join(DOCS_DIR, conversationId);
        if (!fs.existsSync(conversationDocsDir)) {
            fs.mkdirSync(conversationDocsDir, { recursive: true });
        }
        
        // Generar ID para el documento
        const docId = uuidv4();
        
        // Obtener la extensión del archivo
        const fileExt = path.extname(fileName).toLowerCase();
        
        // Determinar formato basado en la extensión
        let format;
        switch (fileExt) {
            case '.pdf':
                format = 'pdf';
                break;
            case '.docx':
            case '.doc':
                format = 'docx';
                break;
            case '.txt':
                format = 'text';
                break;
            case '.csv':
                format = 'csv';
                break;
            case '.xlsx':
            case '.xls':
                format = 'excel';
                break;
            case '.json':
                format = 'json';
                break;
            case '.md':
                format = 'markdown';
                break;
            default:
                format = 'unknown';
        }
        
        // Guardar el archivo original
        const filePath = path.join(conversationDocsDir, `${docId}${fileExt}`);
        fs.writeFileSync(filePath, fileBuffer);
        
        // Extraer texto según formato
        let text = '';
        let extractionSuccess = true;
        let structuredData = null;
        let tableHeaders = [];
        let preview = null;
        
        try {
            switch (format) {
                case 'pdf':
                    if (!pdfParse) {
                        throw new Error('Procesamiento de PDF no disponible');
                    }
                    text = await extractTextFromPDF(fileBuffer);
                    break;
                    
                case 'docx':
                    if (!mammoth) {
                        throw new Error('Procesamiento de DOCX no disponible');
                    }
                    text = await extractTextFromDOCX(fileBuffer);
                    break;
                    
                case 'text':
                case 'markdown':
                    text = fileBuffer.toString('utf8');
                    break;
                    
                case 'csv':
                    if (!csvParse) {
                        throw new Error('Procesamiento de CSV no disponible');
                    }
                    const csvResult = await extractDataFromCSV(fileBuffer);
                    text = csvResult.text;
                    structuredData = csvResult.data;
                    tableHeaders = csvResult.headers || [];
                    preview = generateTablePreview(structuredData, tableHeaders);
                    break;
                    
                case 'excel':
                    if (!xlsx) {
                        throw new Error('Procesamiento de Excel no disponible');
                    }
                    const excelResult = await extractDataFromExcel(fileBuffer);
                    text = excelResult.text;
                    structuredData = excelResult.data;
                    tableHeaders = excelResult.headers || [];
                    preview = generateTablePreview(
                        structuredData[Object.keys(structuredData)[0]], 
                        tableHeaders
                    );
                    break;
                    
                case 'json':
                    try {
                        const jsonData = JSON.parse(fileBuffer.toString('utf8'));
                        text = JSON.stringify(jsonData, null, 2);
                        structuredData = jsonData;
                        
                        // Si es un array, generar vista previa como tabla
                        if (Array.isArray(jsonData) && jsonData.length > 0) {
                            tableHeaders = Object.keys(jsonData[0]);
                            preview = generateTablePreview(jsonData, tableHeaders);
                        }
                    } catch (err) {
                        text = fileBuffer.toString('utf8');
                    }
                    break;
                    
                default:
                    // Intentar leer como texto plano
                    try {
                        text = fileBuffer.toString('utf8');
                    } catch (err) {
                        text = 'Contenido no procesable';
                        extractionSuccess = false;
                    }
            }
        } catch (err) {
            console.error(`DocumentProcessor: Error al extraer texto de ${format}:`, err);
            text = `Error procesando documento: ${err.message}`;
            extractionSuccess = false;
        }
        
        // Truncar texto muy largo para procesamiento y guardado
        let truncated = false;
        if (text.length > MAX_PROCESS_LENGTH) {
            const textForProcessing = text.substring(0, MAX_PROCESS_LENGTH);
            truncated = true;
            
            // Indicar que se truncó en los metadatos
            text = textForProcessing + `\n\n[Contenido truncado. El documento original tiene ${text.length} caracteres, se procesaron ${MAX_PROCESS_LENGTH}]`;
        }
        
        // Guardar el texto extraído
        const textPath = path.join(conversationDocsDir, `${docId}.txt`);
        fs.writeFileSync(textPath, text);
        
        // Generar resumen y conceptos clave
        const summary = generateSummary(text);
        const keyConcepts = extractKeyConcepts(text);
        const entities = extractEntities(text);
        
        // Crear metadatos
        const metadata = {
            id: docId,
            originalName: fileName,
            format,
            size: fileBuffer.length,
            uploadDate: new Date().toISOString(),
            path: filePath,
            textPath,
            extractionSuccess,
            truncated,
            charCount: text.length,
            summary,
            keyConcepts,
            entities,
            hasStructuredData: !!structuredData,
            tableHeaders: tableHeaders,
            preview: preview
        };
        
        // Guardar metadatos
        const metaPath = path.join(conversationDocsDir, `${docId}.meta.json`);
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
        
        // Si hay datos estructurados, guardarlos también
        if (structuredData) {
            const structuredPath = path.join(conversationDocsDir, `${docId}.structured.json`);
            fs.writeFileSync(structuredPath, JSON.stringify(structuredData, null, 2));
        }
        
        console.log(`DocumentProcessor: Documento procesado - ${fileName} (${docId})`);
        
        return metadata;
    } catch (error) {
        console.error('DocumentProcessor: Error al procesar documento:', error);
        throw error;
    }
}

/**
 * Extrae texto de un archivo PDF
 * @param {Buffer} buffer - Buffer del archivo PDF
 * @returns {Promise<string>} Texto extraído
 * @private
 */
async function extractTextFromPDF(buffer) {
    try {
        const data = await pdfParse(buffer, {
            // Opciones para mejorar la extracción
            pagerender: render_page
        });
        return data.text || '';
    } catch (error) {
        console.error('Error extrayendo texto de PDF:', error);
        throw error;
    }
    
    // Función auxiliar para mejorar renderizado de páginas PDF
    function render_page(pageData) {
        let renderOptions = {
            normalizeWhitespace: true,
            disableCombineTextItems: false
        };
        
        return pageData.getTextContent(renderOptions)
            .then(function(textContent) {
                let lastY, text = '';
                for (let item of textContent.items) {
                    if (lastY == item.transform[5] || !lastY){
                        text += item.str;
                    } else {
                        text += '\n' + item.str;
                    }
                    lastY = item.transform[5];
                }
                return text;
            });
    }
}

/**
 * Extrae texto de un archivo DOCX
 * @param {Buffer} buffer - Buffer del archivo DOCX
 * @returns {Promise<string>} Texto extraído
 * @private
 */
async function extractTextFromDOCX(buffer) {
    try {
        const result = await mammoth.extractRawText({ 
            buffer,
            // Opciones para mejorar la extracción
            preserveStyles: true,
            includeDefaultStyleMap: true
        });
        return result.value || '';
    } catch (error) {
        console.error('Error extrayendo texto de DOCX:', error);
        throw error;
    }
}

/**
 * Extrae datos de un archivo CSV
 * @param {Buffer} buffer - Buffer del archivo CSV
 * @returns {Promise<Object>} Texto y datos estructurados extraídos
 * @private
 */
async function extractDataFromCSV(buffer) {
    return new Promise((resolve, reject) => {
        try {
            // Detectar el delimitador examinando una parte del archivo
            const sampleText = buffer.toString('utf8', 0, Math.min(buffer.length, 2048));
            const delimiter = detectCSVDelimiter(sampleText);
            
            const parser = csvParse.parse({
                delimiter: delimiter,
                columns: true,
                skip_empty_lines: true,
                trim: true
            });
            
            const records = [];
            let csvText = '';
            let headers = [];
            
            parser.on('readable', () => {
                let record;
                while ((record = parser.read())) {
                    records.push(record);
                }
            });
            
            parser.on('error', (err) => {
                reject(err);
            });
            
            parser.on('end', () => {
                // Convertir datos a formato legible por humanos
                if (records.length > 0) {
                    // Extraer encabezados
                    headers = Object.keys(records[0]);
                    csvText = headers.join(delimiter) + '\n';
                    
                    // Añadir filas (máximo 100 para legibilidad)
                    const maxRows = Math.min(records.length, 100);
                    for (let i = 0; i < maxRows; i++) {
                        csvText += Object.values(records[i]).join(delimiter) + '\n';
                    }
                    
                    if (records.length > 100) {
                        csvText += `... (${records.length - 100} filas más)`;
                    }
                }
                
                resolve({ 
                    text: csvText, 
                    data: records,
                    headers: headers
                });
            });
            
            parser.write(buffer);
            parser.end();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Detecta el delimitador más probable en un archivo CSV
 * @param {string} sampleText - Muestra de texto del CSV
 * @returns {string} Delimitador detectado
 * @private
 */
function detectCSVDelimiter(sampleText) {
    // Delimitadores comunes a verificar
    const delimiters = [',', ';', '\t', '|'];
    let bestDelimiter = ','; // Por defecto
    let maxScore = 0;
    
    // Obtener líneas de la muestra
    const lines = sampleText.split('\n').filter(line => line.trim().length > 0);
    if (lines.length < 2) return bestDelimiter;
    
    for (const delimiter of delimiters) {
        // Calcular puntaje para este delimitador
        let score = 0;
        
        // Verificar consistencia en el número de columnas
        const columnCounts = lines.map(line => line.split(delimiter).length);
        const mostCommonCount = mode(columnCounts);
        
        // Si el delimitador produce un número consistente de columnas, aumentar puntuación
        if (mostCommonCount > 1) {
            const consistentLines = columnCounts.filter(count => count === mostCommonCount).length;
            const consistencyRatio = consistentLines / lines.length;
            
            score = mostCommonCount * consistencyRatio;
        }
        
        if (score > maxScore) {
            maxScore = score;
            bestDelimiter = delimiter;
        }
    }
    
    return bestDelimiter;
}

/**
 * Encuentra el valor más frecuente en un array
 * @param {Array} array - Array de valores
 * @returns {*} Valor más frecuente
 * @private
 */
function mode(array) {
    if (array.length === 0) return null;
    
    const counts = {};
    let maxCount = 0;
    let maxValue = array[0];
    
    for (const value of array) {
        counts[value] = (counts[value] || 0) + 1;
        if (counts[value] > maxCount) {
            maxCount = counts[value];
            maxValue = value;
        }
    }
    
    return maxValue;
}

/**
 * Extrae datos de un archivo Excel
 * @param {Buffer} buffer - Buffer del archivo Excel
 * @returns {Promise<Object>} Texto y datos estructurados extraídos
 * @private
 */
async function extractDataFromExcel(buffer) {
    try {
        const workbook = xlsx.read(buffer, { 
            type: 'buffer',
            cellDates: true,         // Preservar fechas
            cellStyles: true,        // Preservar estilos
            cellText: true,          // Preservar texto formateado
            cellFormula: true,       // Preservar fórmulas
        });
        
        const firstSheetName = workbook.SheetNames[0];
        const firstSheet = workbook.Sheets[firstSheetName];
        const data = xlsx.utils.sheet_to_json(firstSheet, { 
            header: 'A',             // Usar primera fila como encabezados
            defval: '',              // Valor por defecto para celdas vacías
            blankrows: false         // Ignorar filas vacías
        });
        
        // Extraer encabezados (primera fila)
        let headers = [];
        if (data.length > 0) {
            headers = Object.values(data[0]);
            // Eliminar la fila de encabezados de los datos
            data.shift();
        }
        
        // Convertir a un formato estructurado con encabezados como claves
        const structuredData = data.map(row => {
            const newRow = {};
            Object.entries(row).forEach(([key, value], index) => {
                const headerKey = headers[index] || key;
                newRow[headerKey] = value;
            });
            return newRow;
        });
        
        let excelText = '';
        
        // Convertir datos a formato legible por humanos
        if (structuredData.length > 0) {
            // Encabezados
            excelText = headers.join('\t') + '\n';
            
            // Añadir filas (máximo 100 para legibilidad)
            const maxRows = Math.min(structuredData.length, 100);
            for (let i = 0; i < maxRows; i++) {
                const rowValues = headers.map(header => {
                    const value = structuredData[i][header];
                    return value !== undefined ? value : '';
                });
                excelText += rowValues.join('\t') + '\n';
            }
            
            if (structuredData.length > 100) {
                excelText += `... (${structuredData.length - 100} filas más)`;
            }
            
            // Incluir información sobre todas las hojas
            excelText += `\n\nHojas de cálculo: ${workbook.SheetNames.join(', ')}`;
        }
        
        // Preparar datos estructurados (todas las hojas)
        const sheetData = {};
        
        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const sheetData2 = xlsx.utils.sheet_to_json(sheet, {
                raw: false,          // Convertir a strings para mejor compatibilidad
                dateNF: 'yyyy-mm-dd' // Formato para fechas
            });
            
            sheetData[sheetName] = sheetData2;
        });
        
        return { 
            text: excelText, 
            data: sheetData,
            headers: headers
        };
    } catch (error) {
        console.error('Error extrayendo datos de Excel:', error);
        throw error;
    }
}

/**
 * Genera una vista previa HTML para datos tabulares
 * @param {Array} data - Datos estructurados
 * @param {Array} headers - Encabezados de la tabla
 * @returns {string} HTML para vista previa
 * @private
 */
function generateTablePreview(data, headers) {
    if (!data || !Array.isArray(data) || data.length === 0) {
        return null;
    }
    
    try {
        // Limitar a 10 filas para la vista previa
        const rowsToShow = Math.min(data.length, 10);
        const displayHeaders = headers.length > 0 ? headers : Object.keys(data[0]);
        
        // Limitar a 8 columnas para mejor visualización
        const colsToShow = Math.min(displayHeaders.length, 8);
        const visibleHeaders = displayHeaders.slice(0, colsToShow);
        
        let html = '<div class="table-preview">';
        html += '<table border="1" cellpadding="4" cellspacing="0">';
        
        // Encabezados
        html += '<thead><tr>';
        visibleHeaders.forEach(header => {
            html += `<th>${escapeHtml(header)}</th>`;
        });
        
        if (colsToShow < displayHeaders.length) {
            html += `<th>... (${displayHeaders.length - colsToShow} más)</th>`;
        }
        
        html += '</tr></thead><tbody>';
        
        // Filas de datos
        for (let i = 0; i < rowsToShow; i++) {
            html += '<tr>';
            
            visibleHeaders.forEach(header => {
                const value = data[i][header];
                html += `<td>${escapeHtml(value !== undefined ? value : '')}</td>`;
            });
            
            if (colsToShow < displayHeaders.length) {
                html += '<td>...</td>';
            }
            
            html += '</tr>';
        }
        
        html += '</tbody></table>';
        
        if (data.length > rowsToShow) {
            html += `<div class="table-footer">... (${data.length - rowsToShow} filas más)</div>`;
        }
        
        html += '</div>';
        
        return html;
    } catch (error) {
        console.error('Error generando vista previa de tabla:', error);
        return null;
    }
}

/**
 * Escapa caracteres HTML para prevenir XSS
 * @param {string} unsafe - Texto sin escapar
 * @returns {string} Texto escapado
 * @private
 */
function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Genera un resumen del texto del documento usando algoritmos mejorados
 * @param {string} text - Texto completo del documento
 * @returns {string} Resumen generado
 * @private
 */
function generateSummary(text) {
    try {
        if (!text || text.trim() === '') {
            return 'Documento vacío o no procesable';
        }
        
        // Dividir el texto en párrafos
        const paragraphs = text.split(/\n\s*\n/)
            .filter(p => p.trim().length > 20); // Ignorar párrafos muy cortos
        
        if (paragraphs.length === 0) {
            // Si no hay párrafos largos, usar las primeras líneas
            const lines = text.split('\n');
            const firstLines = lines
                .filter(line => line.trim().length > 0)
                .slice(0, 5)
                .join(' ');
                
            return firstLines.length > 200 
                ? firstLines.substring(0, 200) + '...' 
                : firstLines;
        }
        
        // Si hay pocos párrafos, usar los primeros
        if (paragraphs.length <= 3) {
            let summary = paragraphs.join('\n\n');
            
            // Truncar si es demasiado largo
            if (summary.length > 500) {
                summary = summary.substring(0, 500) + '...';
            }
            
            return summary;
        }
        
        // Para documentos más largos, intentar extraer párrafos más significativos
        
        // 1. Calcular frecuencia de palabras en todo el documento
        const wordFreq = calculateWordFrequency(text);
        
        // 2. Puntuar cada párrafo basado en palabras significativas
        const scoredParagraphs = paragraphs.map(paragraph => {
            const score = calculateParagraphScore(paragraph, wordFreq);
            return { paragraph, score };
        });
        
        // 3. Ordenar párrafos por puntuación y seleccionar los mejores
        const topParagraphs = scoredParagraphs
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(item => item.paragraph);
        
        // 4. Combinar en orden de aparición original
        const orderedTopParagraphs = paragraphs
            .filter(p => topParagraphs.includes(p))
            .slice(0, 3);
        
        let summary = orderedTopParagraphs.join('\n\n');
        
        // Truncar si es demasiado largo
        if (summary.length > 500) {
            summary = summary.substring(0, 500) + '...';
        }
        
        return summary;
    } catch (error) {
        console.error('DocumentProcessor: Error al generar resumen:', error);
        return 'Error al generar resumen';
    }
}

/**
 * Calcula la frecuencia de palabras en un texto
 * @param {string} text - Texto a analizar
 * @returns {Object} Mapa de frecuencia de palabras
 * @private
 */
function calculateWordFrequency(text) {
    // Lista de palabras comunes en español para excluir
    const commonWords = [
        'a', 'al', 'algo', 'algunas', 'algunos', 'ante', 'antes', 'como', 'con', 'contra',
        'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'durante', 'e', 'el', 'ella',
        'ellas', 'ellos', 'en', 'entre', 'era', 'erais', 'eran', 'eras', 'eres', 'es',
        'esa', 'esas', 'ese', 'eso', 'esos', 'esta', 'estaba', 'estabais', 'estaban',
        'estabas', 'estad', 'estada', 'estadas', 'estado', 'estados', 'estamos', 'estando',
        'estar', 'estaremos', 'estará', 'estarán', 'estarás', 'estaré', 'estaréis',
        'estaría', 'estaríais', 'estaríamos', 'estarían', 'estarías', 'estas', 'este',
        'estemos', 'esto', 'estos', 'estoy', 'estuve', 'estuviera', 'estuvierais',
        'estuvieran', 'estuvieras', 'estuvieron', 'estuviese', 'estuvieseis', 'estuviesen',
        'estuvieses', 'estuvimos', 'estuviste', 'estuvisteis', 'estuviéramos',
        'estuviésemos', 'estuvo', 'están', 'estás', 'esté', 'estéis', 'estén', 'estés',
        'fue', 'fuera', 'fuerais', 'fueran', 'fueras', 'fueron', 'fuese', 'fueseis',
        'fuesen', 'fueses', 'fui', 'fuimos', 'fuiste', 'fuisteis', 'fuéramos',
        'fuésemos', 'ha', 'habida', 'habidas', 'habido', 'habidos', 'habiendo', 'habremos',
        'habrá', 'habrán', 'habrás', 'habré', 'habréis', 'habría', 'habríais', 'habríamos',
        'habrían', 'habrías', 'habéis', 'había', 'habíais', 'habíamos', 'habían', 'habías',
        'han', 'has', 'hasta', 'hay', 'haya', 'hayamos', 'hayan', 'hayas', 'hayáis', 'he',
        'hemos', 'hube', 'hubiera', 'hubierais', 'hubieran', 'hubieras', 'hubieron',
        'hubiese', 'hubieseis', 'hubiesen', 'hubieses', 'hubimos', 'hubiste', 'hubisteis',
        'hubiéramos', 'hubiésemos', 'hubo', 'la', 'las', 'le', 'les', 'lo', 'los', 'me',
        'mi', 'mis', 'mucho', 'muchos', 'muy', 'más', 'mí', 'mía', 'mías', 'mío', 'míos',
        'nada', 'ni', 'no', 'nos', 'nosotras', 'nosotros', 'nuestra', 'nuestras', 'nuestro',
        'nuestros', 'o', 'os', 'otra', 'otras', 'otro', 'otros', 'para', 'pero', 'poco',
        'por', 'porque', 'que', 'quien', 'quienes', 'qué', 'se', 'sea', 'seamos', 'sean',
        'seas', 'seremos', 'será', 'serán', 'serás', 'seré', 'seréis', 'sería', 'seríais',
        'seríamos', 'serían', 'serías', 'seáis', 'sido', 'siendo', 'sin', 'sobre', 'sois',
        'somos', 'son', 'soy', 'su', 'sus', 'suya', 'suyas', 'suyo', 'suyos', 'sí', 'también',
        'tanto', 'te', 'tendremos', 'tendrá', 'tendrán', 'tendrás', 'tendré', 'tendréis',
        'tendría', 'tendríais', 'tendríamos', 'tendrían', 'tendrías', 'tened', 'tenemos',
        'tenga', 'tengamos', 'tengan', 'tengas', 'tengo', 'tengáis', 'tenida', 'tenidas',
        'tenido', 'tenidos', 'teniendo', 'tenéis', 'tenía', 'teníais', 'teníamos', 'tenían',
        'tenías', 'ti', 'tiene', 'tienen', 'tienes', 'todo', 'todos', 'tu', 'tus', 'tuve',
        'tuviera', 'tuvierais', 'tuvieran', 'tuvieras', 'tuvieron', 'tuviese', 'tuvieseis',
        'tuviesen', 'tuvieses', 'tuvimos', 'tuviste', 'tuvisteis', 'tuviéramos',
        'tuviésemos', 'tuvo', 'tuya', 'tuyas', 'tuyo', 'tuyos', 'tú', 'un', 'una', 'uno',
        'unos', 'vosotras', 'vosotros', 'vuestra', 'vuestras', 'vuestro', 'vuestros', 'y',
        'ya', 'yo', 'él', 'éramos'
    ];
    
    const wordFreq = {};
    
    // Limpiar y normalizar el texto
    const cleanText = text
        .toLowerCase()
        .replace(/[^\wáéíóúüñ\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Dividir en palabras
    const words = cleanText.split(' ');
    const totalWords = words.length;
    
    // Contar frecuencia de palabras
    words.forEach(word => {
        if (word.length > 3 && !commonWords.includes(word)) {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
    });
    
    // Normalizar por tamaño del documento
    Object.keys(wordFreq).forEach(word => {
        wordFreq[word] = wordFreq[word] / totalWords;
    });
    
    return wordFreq;
}

/**
 * Calcula la puntuación de un párrafo basado en palabras significativas
 * @param {string} paragraph - Párrafo a evaluar
 * @param {Object} wordFreq - Mapa de frecuencia de palabras
 * @returns {number} Puntuación del párrafo
 * @private
 */
function calculateParagraphScore(paragraph, wordFreq) {
    // Normalizar párrafo
    const words = paragraph
        .toLowerCase()
        .replace(/[^\wáéíóúüñ\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ');
    
    let score = 0;
    
    // Puntuar basado en palabras significativas
    words.forEach(word => {
        if (wordFreq[word]) {
            score += wordFreq[word];
        }
    });
    
    // Normalizar por longitud del párrafo
    return score / words.length;
}

/**
 * Extrae conceptos clave del texto del documento usando un algoritmo mejorado
 * @param {string} text - Texto completo del documento
 * @returns {Array} Lista de conceptos clave
 * @private
 */
function extractKeyConcepts(text) {
    try {
        if (!text || text.trim() === '') {
            return [];
        }
        
        // Lista de palabras comunes en español para excluir
        const commonWords = [
            'a', 'al', 'algo', 'algunas', 'algunos', 'ante', 'antes', 'como', 'con', 'contra',
            'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'durante', 'e', 'el', 'ella',
            'ellas', 'ellos', 'en', 'entre', 'era', 'erais', 'eran', 'eras', 'eres', 'es',
            'esa', 'esas', 'ese', 'eso', 'esos', 'esta', 'estaba', 'estabais', 'estaban',
            'estabas', 'estad', 'estada', 'estadas', 'estado', 'estados', 'estamos', 'estando',
            'estar', 'estaremos', 'estará', 'estarán', 'estarás', 'estaré', 'estaréis',
            'estaría', 'estaríais', 'estaríamos', 'estarían', 'estarías', 'estas', 'este',
            'estemos', 'esto', 'estos', 'estoy', 'estuve', 'estuviera', 'estuvierais',
            'estuvieran', 'estuvieras', 'estuvieron', 'estuviese', 'estuvieseis', 'estuviesen',
            'estuvieses', 'estuvimos', 'estuviste', 'estuvisteis', 'estuviéramos',
            'estuviésemos', 'estuvo', 'están', 'estás', 'esté', 'estéis', 'estén', 'estés',
            'fue', 'fuera', 'fuerais', 'fueran', 'fueras', 'fueron', 'fuese', 'fueseis',
            'fuesen', 'fueses', 'fui', 'fuimos', 'fuiste', 'fuisteis', 'fuéramos',
            'fuésemos', 'ha', 'habida', 'habidas', 'habido', 'habidos', 'habiendo', 'habremos',
            'habrá', 'habrán', 'habrás', 'habré', 'habréis', 'habría', 'habríais', 'habríamos',
            'habrían', 'habrías', 'habéis', 'había', 'habíais', 'habíamos', 'habían', 'habías',
            'han', 'has', 'hasta', 'hay', 'haya', 'hayamos', 'hayan', 'hayas', 'hayáis', 'he',
            'hemos', 'hube', 'hubiera', 'hubierais', 'hubieran', 'hubieras', 'hubieron',
            'hubiese', 'hubieseis', 'hubiesen', 'hubieses', 'hubimos', 'hubiste', 'hubisteis',
            'hubiéramos', 'hubiésemos', 'hubo', 'la', 'las', 'le', 'les', 'lo', 'los', 'me',
            'mi', 'mis', 'mucho', 'muchos', 'muy', 'más', 'mí', 'mía', 'mías', 'mío', 'míos',
            'nada', 'ni', 'no', 'nos', 'nosotras', 'nosotros', 'nuestra', 'nuestras', 'nuestro',
            'nuestros', 'o', 'os', 'otra', 'otras', 'otro', 'otros', 'para', 'pero', 'poco',
            'por', 'porque', 'que', 'quien', 'quienes', 'qué', 'se', 'sea', 'seamos', 'sean',
            'seas', 'seremos', 'será', 'serán', 'serás', 'seré', 'seréis', 'sería', 'seríais',
            'seríamos', 'serían', 'serías', 'seáis', 'sido', 'siendo', 'sin', 'sobre', 'sois',
            'somos', 'son', 'soy', 'su', 'sus', 'suya', 'suyas', 'suyo', 'suyos', 'sí', 'también',
            'tanto', 'te', 'tendremos', 'tendrá', 'tendrán', 'tendrás', 'tendré', 'tendréis',
            'tendría', 'tendríais', 'tendríamos', 'tendrían', 'tendrías', 'tened', 'tenemos',
            'tenga', 'tengamos', 'tengan', 'tengas', 'tengo', 'tengáis', 'tenida', 'tenidas',
            'tenido', 'tenidos', 'teniendo', 'tenéis', 'tenía', 'teníais', 'teníamos', 'tenían',
            'tenías', 'ti', 'tiene', 'tienen', 'tienes', 'todo', 'todos', 'tu', 'tus', 'tuve',
            'tuviera', 'tuvierais', 'tuvieran', 'tuvieras', 'tuvieron', 'tuviese', 'tuvieseis',
            'tuviesen', 'tuvieses', 'tuvimos', 'tuviste', 'tuvisteis', 'tuviéramos',
            'tuviésemos', 'tuvo', 'tuya', 'tuyas', 'tuyo', 'tuyos', 'tú', 'un', 'una', 'uno',
            'unos', 'vosotras', 'vosotros', 'vuestra', 'vuestras', 'vuestro', 'vuestros', 'y',
            'ya', 'yo', 'él', 'éramos'
        ];
        
        // Limpiar y normalizar el texto
        const cleanText = text
            .toLowerCase()
            .replace(/[^\wáéíóúüñ\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Dividir en palabras
        const words = cleanText.split(' ');
        
        // Contar frecuencia de palabras
        const wordCount = {};
        const bigramCount = {}; // Para frases de dos palabras
        
        // Procesar palabras individuales
        words.forEach((word, index) => {
            if (word.length > 3 && !commonWords.includes(word)) {
                wordCount[word] = (wordCount[word] || 0) + 1;
            }
            
            // Procesar bigramas (frases de dos palabras)
            if (index < words.length - 1) {
                const nextWord = words[index + 1];
                if (word.length > 2 && nextWord.length > 2 &&
                    !commonWords.includes(word) && !commonWords.includes(nextWord)) {
                    const bigram = `${word} ${nextWord}`;
                    bigramCount[bigram] = (bigramCount[bigram] || 0) + 1;
                }
            }
        });
        
        // Calcular términos TF-IDF (simplificado)
        const totalWords = words.length;
        const documentFreq = {}; // Simular IDF
        
        // Dividir texto en "documentos" (párrafos)
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        
        // Para cada palabra, contar en cuántos párrafos aparece
        Object.keys(wordCount).forEach(word => {
            let docCount = 0;
            paragraphs.forEach(paragraph => {
                if (paragraph.toLowerCase().includes(word)) {
                    docCount++;
                }
            });
            documentFreq[word] = docCount;
        });
        
        // Calcular puntuación para palabras individuales
        const wordScores = {};
        Object.keys(wordCount).forEach(word => {
            const tf = wordCount[word] / totalWords;
            const idf = Math.log(paragraphs.length / (1 + documentFreq[word]));
            wordScores[word] = tf * idf;
        });
        
        // Separar bigramas significativos
        const significantBigrams = Object.entries(bigramCount)
            .filter(([bigram, count]) => count >= 2) // Solo considerar bigramas que aparecen al menos 2 veces
            .map(([bigram, count]) => ({
                word: bigram,
                count,
                importance: Math.min(1, count / 10) // Normalizar importancia
            }));
        
        // Convertir palabras individuales a array y ordenar por puntuación
        const singleWords = Object.entries(wordScores)
            .sort((a, b) => b[1] - a[1])
            .map(([word, score]) => ({
                word,
                count: wordCount[word],
                importance: Math.min(1, score * 20) // Normalizar importancia
            }));
        
        // Combinar bigramas y palabras individuales
        const combinedResults = [
            ...significantBigrams,
            ...singleWords
        ].sort((a, b) => b.importance - a.importance);
        
        // Eliminar duplicados (si una palabra ya está en un bigrama significativo)
        const uniqueResults = [];
        const includedWords = new Set();
        
        combinedResults.forEach(item => {
            const words = item.word.split(' ');
            
            // Verificar si las palabras ya están incluidas en un resultado previo
            const alreadyIncluded = words.some(w => includedWords.has(w));
            
            if (!alreadyIncluded) {
                uniqueResults.push(item);
                words.forEach(w => includedWords.add(w));
            }
        });
        
        return uniqueResults.slice(0, MAX_KEY_CONCEPTS);
    } catch (error) {
        console.error('DocumentProcessor: Error al extraer conceptos clave:', error);
        return [];
    }
}

/**
 * Extrae entidades del texto del documento con detección mejorada
 * @param {string} text - Texto completo del documento
 * @returns {Array} Lista de entidades
 * @private
 */
function extractEntities(text) {
    try {
        if (!text || text.trim() === '') {
            return [];
        }
        
        // Implementación mejorada para detectar entidades
        // En un sistema real, se usaría NLP con modelos pre-entrenados
        
        // Patrones para detección de entidades
        const patterns = [
            // Personas (nombres propios)
            {
                regex: /\b[A-Z][a-zá-úñ]+ (?:[A-Z][a-zá-úñ]+ )?[A-Z][a-zá-úñ]+\b/g,
                type: 'person'
            },
            // Nombres simples que podrían ser personas
            {
                regex: /\b(?:Sr\.|Sra\.|Dr\.|Dra\.|Prof\.) [A-Z][a-zá-úñ]+\b/g,
                type: 'person'
            },
            // Organizaciones con mejor detección
            {
                regex: /\b(?:Empresa|Compañía|Corporación|Inc\.|Corp\.|S\.A\.|Ltd\.|LLC|Universidad|Colegio|Escuela|Ministerio|Departamento|Gobierno|Fundación|Asociación|Grupo|Consejo|Comisión|Instituto|Centro|Organización|Sociedad)\s+(?:[A-Z][a-zá-úñ]*(?:\s+[A-Za-zá-úñ]+)*)\b/g,
                type: 'organization'
            },
            // Países y ciudades grandes
            {
                regex: /\b(?:España|Madrid|Barcelona|Valencia|México|Argentina|Colombia|Chile|Perú|Estados Unidos|Francia|Alemania|Italia|Reino Unido|China|Japón|Brasil|India|Rusia|Canadá|Australia)\b/g,
                type: 'location'
            },
            // Ubicaciones con preposiciones
            {
                regex: /\b(?:en|desde|hasta|hacia|de)\s+[A-Z][a-zá-úñ]+(?:\s+[de|la|las|los|del])?(?:\s+[A-Z][a-zá-úñ]+)*\b/g,
                type: 'location',
                filter: match => match.replace(/^(?:en|desde|hasta|hacia|de)\s+/, '')
            },
            // Fechas en diversos formatos
            {
                regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}-\d{1,2}-\d{2,4}\b|\b\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{2,4}\b/g,
                type: 'date'
            },
            // Tecnologías, productos y términos técnicos
            {
                regex: /\b(?:Inteligencia Artificial|Machine Learning|IA|ML|NLP|Procesamiento de Lenguaje Natural|Blockchain|Cloud Computing|Internet of Things|IoT|Big Data|API|REST|SDK|SaaS|PaaS|IaaS|DevOps|CI\/CD|Docker|Kubernetes|JavaScript|Python|Java|React|Angular|Vue|Node\.js|Django|Flask|TensorFlow|PyTorch|SQL|NoSQL|MongoDB|PostgreSQL|MySQL|Redis|Cassandra|AWS|Azure|Google Cloud|GCP|Firebase|Heroku)\b/g,
                type: 'technology'
            },
            // Cantidades monetarias
            {
                regex: /\b\$\s*\d+(?:[.,]\d+)*(?:\s*(?:USD|EUR|MXN|ARS|CLP|PEN|COP|BRL))?\b|\b\d+(?:[.,]\d+)*\s*(?:dólares|euros|pesos|reales)\b/g,
                type: 'money'
            },
            // Porcentajes
            {
                regex: /\b\d+(?:[,.]\d+)?%\b|\b\d+(?:[,.]\d+)? por ciento\b/g,
                type: 'percentage'
            },
            // Correos electrónicos
            {
                regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
                type: 'email'
            },
            // URLs
            {
                regex: /\bhttps?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)\b/g,
                type: 'url'
            },
            // Teléfonos
            {
                regex: /\b(?:\+\d{1,3}[ -])?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/g,
                type: 'phone'
            }
        ];
        
        const entities = {};
        
        // Aplicar cada patrón
        patterns.forEach(pattern => {
            const matches = text.match(pattern.regex) || [];
            
            matches.forEach(match => {
                // Aplicar filtro si existe
                const entity = pattern.filter ? pattern.filter(match) : match;
                
                if (entity && entity.length > 2) { // Ignorar entidades muy cortas
                    const key = entity.toLowerCase();
                    
                    entities[key] = entities[key] || {
                        name: entity,
                        type: pattern.type,
                        count: 0
                    };
                    
                    entities[key].count++;
                }
            });
        });
        
        // Convertir a array y ordenar por frecuencia y relevancia
        const sortedEntities = Object.values(entities)
            .sort((a, b) => {
                // Dar prioridad a personas, organizaciones y ubicaciones
                const priorityTypes = { 'person': 3, 'organization': 2, 'location': 1 };
                const typePriorityA = priorityTypes[a.type] || 0;
                const typePriorityB = priorityTypes[b.type] || 0;
                
                if (typePriorityA !== typePriorityB) {
                    return typePriorityB - typePriorityA;
                }
                
                // Si tienen la misma prioridad, ordenar por frecuencia
                return b.count - a.count;
            })
            .slice(0, 25); // Limitar a 25 entidades
        
        return sortedEntities;
    } catch (error) {
        console.error('DocumentProcessor: Error al extraer entidades:', error);
        return [];
    }
}

/**
 * Obtiene documentos asociados a una conversación
 * @param {string} conversationId - ID de la conversación
 * @returns {Promise<Array>} Lista de documentos
 */
async function getConversationDocuments(conversationId) {
    try {
        const conversationDocsDir = path.join(DOCS_DIR, conversationId);
        
        if (!fs.existsSync(conversationDocsDir)) {
            return [];
        }
        
        // Obtener todos los archivos de metadatos
        const files = fs.readdirSync(conversationDocsDir)
            .filter(file => file.endsWith('.meta.json'));
        
        // Cargar metadatos de cada documento
        const documents = files.map(file => {
            try {
                const metaPath = path.join(conversationDocsDir, file);
                const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                
                // Eliminar información demasiado larga para transmisión
                const cleanMetadata = { ...metadata };
                delete cleanMetadata.preview; // Enviarlo solo cuando se solicite específicamente
                
                return cleanMetadata;
            } catch (err) {
                console.error(`Error al leer metadatos de ${file}:`, err);
                return null;
            }
        }).filter(doc => doc !== null);
        
        return documents;
    } catch (error) {
        console.error('DocumentProcessor: Error al obtener documentos:', error);
        return [];
    }
}

/**
 * Obtiene el contenido de un documento específico
 * @param {string} conversationId - ID de la conversación
 * @param {string} docId - ID del documento
 * @returns {Promise<Object>} Contenido y metadatos del documento
 */
async function getDocumentContent(conversationId, docId) {
    try {
        const conversationDocsDir = path.join(DOCS_DIR, conversationId);
        const metaPath = path.join(conversationDocsDir, `${docId}.meta.json`);
        
        if (!fs.existsSync(metaPath)) {
            throw new Error('Documento no encontrado');
        }
        
        // Cargar metadatos
        const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        
        // Cargar texto del documento
        const textPath = path.join(conversationDocsDir, `${docId}.txt`);
        let text = '';
        
        if (fs.existsSync(textPath)) {
            text = fs.readFileSync(textPath, 'utf8');
        }
        
        // Cargar datos estructurados si existen
        let structuredData = null;
        const structuredPath = path.join(conversationDocsDir, `${docId}.structured.json`);
        
        if (fs.existsSync(structuredPath)) {
            structuredData = JSON.parse(fs.readFileSync(structuredPath, 'utf8'));
        }
        
        return {
            ...metadata,
            text,
            structuredData
        };
    } catch (error) {
        console.error('DocumentProcessor: Error al obtener contenido del documento:', error);
        throw error;
    }
}

/**
 * Elimina un documento
 * @param {string} conversationId - ID de la conversación
 * @param {string} docId - ID del documento
 * @returns {Promise<boolean>} True si se eliminó correctamente
 */
async function deleteDocument(conversationId, docId) {
    try {
        const conversationDocsDir = path.join(DOCS_DIR, conversationId);
        const metaPath = path.join(conversationDocsDir, `${docId}.meta.json`);
        
        if (!fs.existsSync(metaPath)) {
            throw new Error('Documento no encontrado');
        }
        
        // Cargar metadatos para obtener ruta al archivo original
        const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        
        // Archivos a eliminar
        const filesToDelete = [
            metaPath,
            path.join(conversationDocsDir, `${docId}.txt`)
        ];
        
        // Añadir archivo original si existe
        if (metadata.path && fs.existsSync(metadata.path)) {
            filesToDelete.push(metadata.path);
        }
        
        // Añadir datos estructurados si existen
        const structuredPath = path.join(conversationDocsDir, `${docId}.structured.json`);
        if (fs.existsSync(structuredPath)) {
            filesToDelete.push(structuredPath);
        }
        
        // Eliminar archivos
        filesToDelete.forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        });
        
        console.log(`DocumentProcessor: Documento eliminado - ${docId}`);
        return true;
    } catch (error) {
        console.error('DocumentProcessor: Error al eliminar documento:', error);
        throw error;
    }
}

/**
 * Busca texto dentro de documentos
 * @param {string} conversationId - ID de la conversación
 * @param {string} searchTerm - Término de búsqueda
 * @returns {Promise<Array>} Resultados de la búsqueda
 */
async function searchDocuments(conversationId, searchTerm) {
    try {
        if (!searchTerm || searchTerm.trim().length < 2) {
            return [];
        }
        
        const term = searchTerm.toLowerCase().trim();
        const documents = await getConversationDocuments(conversationId);
        const results = [];
        
        // Buscar en cada documento
        for (const doc of documents) {
            try {
                // Verificar en metadatos
                let matched = false;
                let contexts = [];
                
                // Buscar en título y conceptos clave
                if (doc.originalName.toLowerCase().includes(term)) {
                    matched = true;
                    contexts.push(`Nombre: ${doc.originalName}`);
                }
                
                if (doc.keyConcepts && doc.keyConcepts.some(kc => 
                    kc.word.toLowerCase().includes(term)
                )) {
                    matched = true;
                    const matchedConcepts = doc.keyConcepts
                        .filter(kc => kc.word.toLowerCase().includes(term))
                        .map(kc => kc.word)
                        .join(', ');
                    contexts.push(`Conceptos: ${matchedConcepts}`);
                }
                
                if (doc.entities && doc.entities.some(e => 
                    e.name.toLowerCase().includes(term)
                )) {
                    matched = true;
                    const matchedEntities = doc.entities
                        .filter(e => e.name.toLowerCase().includes(term))
                        .map(e => e.name)
                        .join(', ');
                    contexts.push(`Entidades: ${matchedEntities}`);
                }
                
                // Buscar en el contenido del texto
                const textPath = path.join(DOCS_DIR, conversationId, `${doc.id}.txt`);
                if (fs.existsSync(textPath)) {
                    const content = fs.readFileSync(textPath, 'utf8');
                    
                    if (content.toLowerCase().includes(term)) {
                        matched = true;
                        
                        // Extraer contextos donde aparece el término
                        const lines = content.split('\n');
                        const matchingLines = [];
                        
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].toLowerCase().includes(term)) {
                                const line = lines[i].trim();
                                if (line.length > 0) {
                                    matchingLines.push(line);
                                    
                                    // Limitar a 5 contextos para no sobrecargar
                                    if (matchingLines.length >= 5) {
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // Si hay demasiadas coincidencias, extraer fragmentos
                        if (matchingLines.length > 0) {
                            matchingLines.forEach(line => {
                                // Crear fragmento con contexto alrededor de la coincidencia
                                const index = line.toLowerCase().indexOf(term);
                                const start = Math.max(0, index - 40);
                                const end = Math.min(line.length, index + term.length + 40);
                                
                                let fragment = line.substring(start, end);
                                if (start > 0) fragment = '...' + fragment;
                                if (end < line.length) fragment = fragment + '...';
                                
                                contexts.push(fragment);
                            });
                        }
                    }
                }
                
                if (matched) {
                    results.push({
                        docId: doc.id,
                        fileName: doc.originalName,
                        format: doc.format,
                        uploadDate: doc.uploadDate,
                        contexts: contexts.slice(0, 5) // Limitar a 5 contextos
                    });
                }
            } catch (err) {
                console.error(`Error buscando en documento ${doc.id}:`, err);
            }
        }
        
        return results;
    } catch (error) {
        console.error('DocumentProcessor: Error al buscar en documentos:', error);
        throw error;
    }
}

/**
 * Migra documentos antiguos al nuevo formato
 * @returns {Promise<Object>} Resultado de la migración
 */
async function migrateOldDocuments() {
    try {
        const conversations = fs.readdirSync(DOCS_DIR)
            .filter(item => {
                const itemPath = path.join(DOCS_DIR, item);
                return fs.statSync(itemPath).isDirectory();
            });
        
        let totalMigrated = 0;
        const results = {};
        
        for (const conversationId of conversations) {
            try {
                const conversationDir = path.join(DOCS_DIR, conversationId);
                const files = fs.readdirSync(conversationDir);
                
                // Buscar documentos sin metadatos
                const docsWithoutMeta = files
                    .filter(file => 
                        !file.endsWith('.meta.json') && 
                        !file.endsWith('.txt') &&
                        !file.endsWith('.structured.json')
                    );
                
                let conversationMigrated = 0;
                
                for (const file of docsWithoutMeta) {
                    // Verificar si ya existe un metadato para este archivo
                    const fileId = path.basename(file).split('.')[0];
                    const metaPath = path.join(conversationDir, `${fileId}.meta.json`);
                    
                    // Si no existe metadato, crear uno
                    if (!fs.existsSync(metaPath)) {
                        try {
                            const filePath = path.join(conversationDir, file);
                            const fileBuffer = fs.readFileSync(filePath);
                            const fileExt = path.extname(file);
                            const originalName = file;
                            
                            // Generar metadatos básicos
                            const metadata = {
                                id: fileId,
                                originalName,
                                format: getFormatFromExtension(fileExt),
                                size: fileBuffer.length,
                                uploadDate: fs.statSync(filePath).mtime.toISOString(),
                                path: filePath,
                                textPath: path.join(conversationDir, `${fileId}.txt`),
                                extractionSuccess: false,
                                migrated: true
                            };
                            
                            // Intentar extraer texto si es posible
                            try {
                                const text = extractTextFromFileBuffer(fileBuffer, fileExt);
                                fs.writeFileSync(metadata.textPath, text);
                                metadata.extractionSuccess = true;
                                
                                // Generar metadatos adicionales
                                metadata.summary = generateSummary(text);
                                metadata.keyConcepts = extractKeyConcepts(text);
                                metadata.entities = extractEntities(text);
                            } catch (extractError) {
                                console.error(`Error extrayendo texto de ${file}:`, extractError);
                            }
                            
                            // Guardar metadatos
                            fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
                            conversationMigrated++;
                            totalMigrated++;
                        } catch (migrationError) {
                            console.error(`Error migrando ${file}:`, migrationError);
                        }
                    }
                }
                
                if (conversationMigrated > 0) {
                    results[conversationId] = conversationMigrated;
                }
            } catch (conversationError) {
                console.error(`Error procesando conversación ${conversationId}:`, conversationError);
            }
        }
        
        return {
            success: true,
            totalMigrated,
            details: results
        };
    } catch (error) {
        console.error('DocumentProcessor: Error en migración de documentos:', error);
        return {
            success: false,
            error: error.message
        };
    }
    
    /**
     * Determina el formato basado en la extensión
     * @param {string} fileExt - Extensión del archivo
     * @returns {string} Formato del archivo
     */
    function getFormatFromExtension(fileExt) {
        const ext = fileExt.toLowerCase();
        
        switch (ext) {
            case '.pdf': return 'pdf';
            case '.docx':
            case '.doc': return 'docx';
            case '.txt': return 'text';
            case '.csv': return 'csv';
            case '.xlsx':
            case '.xls': return 'excel';
            case '.json': return 'json';
            case '.md': return 'markdown';
            default: return 'unknown';
        }
    }
    
    /**
     * Extrae texto de un buffer de archivo
     * @param {Buffer} buffer - Buffer del archivo
     * @param {string} fileExt - Extensión del archivo
     * @returns {string} Texto extraído
     */
    function extractTextFromFileBuffer(buffer, fileExt) {
        const format = getFormatFromExtension(fileExt);
        
        switch (format) {
            case 'pdf':
                if (!pdfParse) {
                    return 'Procesamiento de PDF no disponible';
                }
                return 'Contenido de PDF (migrado)';
            
            case 'docx':
                if (!mammoth) {
                    return 'Procesamiento de DOCX no disponible';
                }
                return 'Contenido de DOCX (migrado)';
            
            case 'text':
            case 'markdown':
                return buffer.toString('utf8');
            
            case 'csv':
                return 'Contenido de CSV (migrado)';
            
            case 'excel':
                return 'Contenido de Excel (migrado)';
            
            case 'json':
                try {
                    const jsonData = JSON.parse(buffer.toString('utf8'));
                    return JSON.stringify(jsonData, null, 2);
                } catch (err) {
                    return buffer.toString('utf8');
                }
            
            default:
                // Intentar leer como texto plano
                try {
                    return buffer.toString('utf8');
                } catch (err) {
                    return 'Contenido no procesable';
                }
        }
    }
}

// Inicializar el módulo
init();

module.exports = {
    init,
    checkDependencies,
    processDocument,
    getConversationDocuments,
    getDocumentContent,
    deleteDocument,
    searchDocuments,
    migrateOldDocuments
};