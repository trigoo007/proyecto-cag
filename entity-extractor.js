/**
 * Extractor de Entidades para CAG
 * 
 * Este módulo se encarga de identificar y extraer entidades de los mensajes
 * para enriquecer el contexto y mejorar las respuestas generadas.
 */

const fs = require('fs');
const path = require('path');

// Directorio para almacenamiento de datos
const DATA_DIR = path.join(__dirname, 'data');
const ENTITIES_DIR = path.join(DATA_DIR, 'entities');

// Límite de entidades a extraer por mensaje
const MAX_ENTITIES = 15;

/**
 * Inicializa el extractor de entidades
 */
function init() {
    try {
        // Crear directorio de entidades si no existe
        if (!fs.existsSync(ENTITIES_DIR)) {
            fs.mkdirSync(ENTITIES_DIR, { recursive: true });
            console.log('EntityExtractor: Directorio de entidades creado');
        }
        
        // Cargar datos de entidades conocidas
        loadEntityDatabases();
        
        console.log('EntityExtractor: Inicializado correctamente');
    } catch (error) {
        console.error('EntityExtractor: Error de inicialización:', error);
    }
}

// Bases de datos de entidades conocidas
let knownPersons = [];
let knownOrganizations = [];
let knownLocations = [];
let knownConcepts = [];

/**
 * Carga las bases de datos de entidades conocidas
 * @private
 */
function loadEntityDatabases() {
    try {
        const databaseFiles = [
            { path: path.join(ENTITIES_DIR, 'persons.json'), target: 'persons' },
            { path: path.join(ENTITIES_DIR, 'organizations.json'), target: 'organizations' },
            { path: path.join(ENTITIES_DIR, 'locations.json'), target: 'locations' },
            { path: path.join(ENTITIES_DIR, 'concepts.json'), target: 'concepts' }
        ];
        
        databaseFiles.forEach(db => {
            if (fs.existsSync(db.path)) {
                try {
                    const data = JSON.parse(fs.readFileSync(db.path, 'utf8'));
                    
                    switch (db.target) {
                        case 'persons':
                            knownPersons = data;
                            break;
                        case 'organizations':
                            knownOrganizations = data;
                            break;
                        case 'locations':
                            knownLocations = data;
                            break;
                        case 'concepts':
                            knownConcepts = data;
                            break;
                    }
                    
                    console.log(`EntityExtractor: Cargadas ${data.length} entidades de ${db.target}`);
                } catch (parseError) {
                    console.error(`EntityExtractor: Error al parsear ${db.path}:`, parseError);
                }
            } else {
                // Crear archivo vacío si no existe
                fs.writeFileSync(db.path, JSON.stringify([], null, 2), 'utf8');
                console.log(`EntityExtractor: Creado archivo ${db.path}`);
            }
        });
    } catch (error) {
        console.error('EntityExtractor: Error al cargar bases de datos:', error);
    }
}

/**
 * Extrae entidades de un texto
 * @param {string} text - Texto a analizar
 * @returns {Promise<Array>} Lista de entidades extraídas
 */
async function extractEntities(text) {
    try {
        if (!text || text.trim() === '') {
            return [];
        }
        
        // Combinar múltiples estrategias de extracción
        const [patternEntities, knownEntities] = await Promise.all([
            extractEntitiesByPattern(text),
            matchKnownEntities(text)
        ]);
        
        // Combinar resultados sin duplicados
        const combinedEntities = [...patternEntities];
        
        // Añadir entidades conocidas que no estén ya incluidas
        knownEntities.forEach(known => {
            if (!combinedEntities.some(e => 
                e.name.toLowerCase() === known.name.toLowerCase() && 
                e.type === known.type
            )) {
                combinedEntities.push(known);
            }
        });
        
        // Ordenar por relevancia y limitar cantidad
        return combinedEntities
            .sort((a, b) => {
                // Primero ordenar por confianza
                if (a.confidence !== b.confidence) {
                    return b.confidence - a.confidence;
                }
                // Luego por longitud del nombre (nombres más largos suelen ser más específicos)
                return b.name.length - a.name.length;
            })
            .slice(0, MAX_ENTITIES);
    } catch (error) {
        console.error('EntityExtractor: Error al extraer entidades:', error);
        return [];
    }
}

/**
 * Extrae entidades basadas en patrones
 * @param {string} text - Texto a analizar
 * @returns {Promise<Array>} Lista de entidades extraídas
 * @private
 */
async function extractEntitiesByPattern(text) {
    try {
        // Patrones para detección de entidades
        const entityPatterns = [
            // Personas (nombres propios)
            {
                regex: /\b[A-Z][a-zá-úñ]+ (?:[A-Z][a-zá-úñ]+ )?[A-Z][a-zá-úñ]+\b/g,
                type: 'person',
                confidence: 0.7
            },
            // Personas con títulos
            {
                regex: /\b(?:Sr\.|Sra\.|Dr\.|Dra\.|Prof\.|Don|Doña) [A-Z][a-zá-úñ]+(?:\s+[A-Z][a-zá-úñ]+)?\b/g,
                type: 'person',
                confidence: 0.85,
                transform: match => match.replace(/^(?:Sr\.|Sra\.|Dr\.|Dra\.|Prof\.|Don|Doña) /, '')
            },
            // Organizaciones
            {
                regex: /\b(?:Empresa|Compañía|Corporación|Inc\.|Corp\.|S\.A\.|S\.L\.|Ltd\.|LLC|Grupo|Universidad|Colegio|Escuela|Ministerio|Departamento|Gobierno|Fundación|Asociación|Instituto|Centro|Organización)\s+(?:[A-Z][a-zá-úñ]*(?:\s+[A-Za-zá-úñ&]+)*)\b/g,
                type: 'organization',
                confidence: 0.75
            },
            // Organizaciones con acrónimos
            {
                regex: /\b[A-Z]{2,}(?:\s+[A-Za-zá-úñ&]+){1,3}\b/g,
                type: 'organization',
                confidence: 0.65
            },
            // Ubicaciones con preposiciones
            {
                regex: /\b(?:en|desde|hasta|hacia|de)\s+[A-Z][a-zá-úñ]+(?:\s+(?:de|la|las|los|del)\s+[A-Z][a-zá-úñ]+)*\b/g,
                type: 'location',
                confidence: 0.7,
                transform: match => match.replace(/^(?:en|desde|hasta|hacia|de)\s+/, '')
            },
            // Países y ciudades grandes (explícitos)
            {
                regex: /\b(?:España|Madrid|Barcelona|México|Argentina|Colombia|Chile|Perú|Brasil|Estados Unidos|Francia|Alemania|Reino Unido|Italia|China|Japón|Rusia|India|Australia|Canadá)\b/g,
                type: 'location',
                confidence: 0.9
            },
            // Fechas en diversos formatos
            {
                regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}-\d{1,2}-\d{2,4}\b|\b\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{2,4}\b/g,
                type: 'date',
                confidence: 0.95
            },
            // Tecnologías y términos técnicos
            {
                regex: /\b(?:Inteligencia Artificial|Machine Learning|Deep Learning|Procesamiento de Lenguaje Natural|NLP|Blockchain|Internet of Things|IoT|Big Data|Cloud Computing|API|REST|GraphQL|DevOps|CI\/CD|Docker|Kubernetes|AWS|Azure|Google Cloud)\b/g,
                type: 'technology',
                confidence: 0.85
            },
            // Lenguajes de programación y frameworks
            {
                regex: /\b(?:JavaScript|Python|Java|C\+\+|C#|PHP|Ruby|Swift|Kotlin|Go|Rust|React|Angular|Vue|Node\.js|Django|Flask|Laravel|Spring|TensorFlow|PyTorch|pandas|NumPy|SQL|NoSQL|MongoDB|PostgreSQL|MySQL)\b/g,
                type: 'technology',
                confidence: 0.9
            },
            // Cantidades monetarias
            {
                regex: /\b\$\s*\d+(?:[.,]\d+)*(?:\s*(?:USD|EUR|MXN|ARS|CLP|PEN|COP|BRL))?\b|\b\d+(?:[.,]\d+)*\s*(?:dólares|euros|pesos|reales)\b/g,
                type: 'money',
                confidence: 0.9
            },
            // Correos electrónicos
            {
                regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
                type: 'email',
                confidence: 0.95
            },
            // URLs
            {
                regex: /\bhttps?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)\b/g,
                type: 'url',
                confidence: 0.95
            }
        ];
        
        const entities = {};
        
        // Aplicar cada patrón
        entityPatterns.forEach(pattern => {
            const matches = [...new Set(text.match(pattern.regex) || [])];
            
            matches.forEach(match => {
                // Aplicar transformación si existe
                const entityName = pattern.transform ? pattern.transform(match) : match;
                
                if (entityName && entityName.length > 2) {
                    const key = `${pattern.type}:${entityName.toLowerCase()}`;
                    
                    // No duplicar entidades ya detectadas
                    if (!entities[key]) {
                        entities[key] = {
                            name: entityName,
                            type: pattern.type,
                            confidence: pattern.confidence,
                            source: 'pattern'
                        };
                    }
                }
            });
        });
        
        return Object.values(entities);
    } catch (error) {
        console.error('EntityExtractor: Error en extracción por patrones:', error);
        return [];
    }
}

/**
 * Busca entidades conocidas en el texto
 * @param {string} text - Texto a analizar
 * @returns {Promise<Array>} Lista de entidades encontradas
 * @private
 */
async function matchKnownEntities(text) {
    try {
        const lowerText = ` ${text.toLowerCase()} `; // Añadir espacios para mejorar coincidencias de palabras completas
        const matches = [];
        
        // Revisar entidades conocidas por tipo
        const databases = [
            { entities: knownPersons, type: 'person', confidence: 0.85 },
            { entities: knownOrganizations, type: 'organization', confidence: 0.85 },
            { entities: knownLocations, type: 'location', confidence: 0.85 },
            { entities: knownConcepts, type: 'concept', confidence: 0.8 }
        ];
        
        databases.forEach(db => {
            db.entities.forEach(entity => {
                // Buscar coincidencias exactas
                const entityName = entity.name.toLowerCase();
                if (lowerText.includes(` ${entityName} `) || 
                    lowerText.includes(` ${entityName}.`) || 
                    lowerText.includes(` ${entityName},`) ||
                    lowerText.includes(`(${entityName})`) ||
                    lowerText.includes(`"${entityName}"`) ||
                    lowerText.includes(`'${entityName}'`)) {
                    
                    matches.push({
                        name: entity.name,  // Usar el nombre con formato correcto
                        type: db.type,
                        confidence: db.confidence,
                        source: 'database',
                        description: entity.description
                    });
                    return;
                }
                
                // Buscar coincidencias de alias
                if (entity.aliases && Array.isArray(entity.aliases)) {
                    for (const alias of entity.aliases) {
                        const aliasLower = alias.toLowerCase();
                        if (lowerText.includes(` ${aliasLower} `) || 
                            lowerText.includes(` ${aliasLower}.`) || 
                            lowerText.includes(` ${aliasLower},`) ||
                            lowerText.includes(`(${aliasLower})`) ||
                            lowerText.includes(`"${aliasLower}"`) ||
                            lowerText.includes(`'${aliasLower}'`)) {
                            
                            matches.push({
                                name: entity.name,  // Usar el nombre principal
                                matchedAlias: alias,
                                type: db.type,
                                confidence: db.confidence * 0.95, // Ligeramente menor confianza para alias
                                source: 'database',
                                description: entity.description
                            });
                            return;
                        }
                    }
                }
            });
        });
        
        return matches;
    } catch (error) {
        console.error('EntityExtractor: Error en coincidencia de entidades conocidas:', error);
        return [];
    }
}

/**
 * Añade o actualiza una entidad en la base de datos
 * @param {Object} entity - Entidad a guardar
 * @returns {Promise<boolean>} True si se guardó correctamente
 */
async function saveEntity(entity) {
    try {
        if (!entity || !entity.name || !entity.type) {
            return false;
        }
        
        // Determinar archivo según tipo
        let databaseFile;
        let entityList;
        
        switch (entity.type.toLowerCase()) {
            case 'person':
                databaseFile = path.join(ENTITIES_DIR, 'persons.json');
                entityList = knownPersons;
                break;
            case 'organization':
                databaseFile = path.join(ENTITIES_DIR, 'organizations.json');
                entityList = knownOrganizations;
                break;
            case 'location':
                databaseFile = path.join(ENTITIES_DIR, 'locations.json');
                entityList = knownLocations;
                break;
            case 'concept':
                databaseFile = path.join(ENTITIES_DIR, 'concepts.json');
                entityList = knownConcepts;
                break;
            default:
                return false;
        }
        
        // Verificar si la entidad ya existe
        const existingIndex = entityList.findIndex(e => 
            e.name.toLowerCase() === entity.name.toLowerCase()
        );
        
        // Añadir o actualizar
        if (existingIndex >= 0) {
            // Actualizar entidad existente preservando campos importantes
            const existing = entityList[existingIndex];
            
            entityList[existingIndex] = {
                ...existing,
                ...entity,
                lastUpdated: new Date().toISOString(),
                occurrences: (existing.occurrences || 0) + 1,
                aliases: [...new Set([...(existing.aliases || []), ...(entity.aliases || [])])],
                history: [...(existing.history || []), 
                    { timestamp: new Date().toISOString(), change: 'updated' }
                ]
            };
        } else {
            // Añadir nueva entidad
            entityList.push({
                ...entity,
                created: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                occurrences: 1,
                history: [{ timestamp: new Date().toISOString(), change: 'created' }]
            });
        }
        
        // Guardar a disco
        fs.writeFileSync(databaseFile, JSON.stringify(entityList, null, 2), 'utf8');
        
        return true;
    } catch (error) {
        console.error('EntityExtractor: Error al guardar entidad:', error);
        return false;
    }
}

/**
 * Busca entidades por nombre o alias
 * @param {string} query - Texto de búsqueda
 * @param {Object} options - Opciones de búsqueda
 * @returns {Promise<Array>} Entidades encontradas
 */
async function searchEntities(query, options = {}) {
    try {
        if (!query || query.trim() === '') {
            return [];
        }
        
        const searchTerm = query.toLowerCase().trim();
        const results = [];
        
        // Determinar qué bases de datos buscar
        const databasesToSearch = [];
        
        if (!options.type || options.type === 'person') {
            databasesToSearch.push({ list: knownPersons, type: 'person' });
        }
        
        if (!options.type || options.type === 'organization') {
            databasesToSearch.push({ list: knownOrganizations, type: 'organization' });
        }
        
        if (!options.type || options.type === 'location') {
            databasesToSearch.push({ list: knownLocations, type: 'location' });
        }
        
        if (!options.type || options.type === 'concept') {
            databasesToSearch.push({ list: knownConcepts, type: 'concept' });
        }
        
        // Realizar búsqueda
        databasesToSearch.forEach(db => {
            db.list.forEach(entity => {
                let match = false;
                let matchField = null;
                
                // Verificar nombre
                if (entity.name.toLowerCase().includes(searchTerm)) {
                    match = true;
                    matchField = 'name';
                }
                
                // Verificar alias
                if (!match && entity.aliases && Array.isArray(entity.aliases)) {
                    for (const alias of entity.aliases) {
                        if (alias.toLowerCase().includes(searchTerm)) {
                            match = true;
                            matchField = 'alias';
                            break;
                        }
                    }
                }
                
                // Verificar descripción
                if (!match && entity.description && 
                    entity.description.toLowerCase().includes(searchTerm)) {
                    match = true;
                    matchField = 'description';
                }
                
                if (match) {
                    results.push({
                        ...entity,
                        matchType: matchField,
                        entityType: db.type
                    });
                }
            });
        });
        
        // Ordenar resultados (nombres exactos primero)
        return results.sort((a, b) => {
            // Priorizar coincidencias en el nombre
            if (a.matchType !== b.matchType) {
                if (a.matchType === 'name') return -1;
                if (b.matchType === 'name') return 1;
            }
            
            // Luego por frecuencia de ocurrencia
            return (b.occurrences || 0) - (a.occurrences || 0);
        });
    } catch (error) {
        console.error('EntityExtractor: Error al buscar entidades:', error);
        return [];
    }
}

/**
 * Extrae y analiza las relaciones entre entidades
 * @param {Array} entities - Entidades a analizar
 * @param {string} text - Texto original
 * @returns {Promise<Array>} Relaciones encontradas
 */
async function extractEntityRelations(entities, text) {
    try {
        if (!entities || entities.length < 2 || !text) {
            return [];
        }
        
        const relations = [];
        
        // Patrones verbales que indican relaciones
        const relationPatterns = [
            { verb: /(?:es|era|fue|son|eran|fueron) (?:un|una|el|la|los|las) (?:fundador|creador|inventor|autor|director|presidente|CEO|jefe|líder) de/i, 
              relation: 'fundador_de', sourceType: 'person', targetType: 'organization' },
            { verb: /(?:es|era|fue|son|eran|fueron) (?:parte|miembro) de/i, 
              relation: 'miembro_de', sourceType: 'person', targetType: 'organization' },
            { verb: /(?:trabaja|trabajaba|trabajó) (?:en|para)/i, 
              relation: 'trabaja_para', sourceType: 'person', targetType: 'organization' },
            { verb: /(?:está|estaba|estuvo) (?:ubicado|ubicada|localizado|localizada|situado|situada) en/i, 
              relation: 'ubicado_en', sourceType: 'organization', targetType: 'location' },
            { verb: /(?:vive|vivía|vivió|reside|residía|residió) en/i, 
              relation: 'vive_en', sourceType: 'person', targetType: 'location' },
            { verb: /(?:creó|desarrolló|inventó|fundó|estableció)/i, 
              relation: 'creador_de', sourceType: 'person', targetType: 'organization' },
            { verb: /(?:es|era|fue) conocido por/i, 
              relation: 'conocido_por', sourceType: 'person', targetType: 'concept' },
            { verb: /(?:nació|creció) en/i, 
              relation: 'lugar_nacimiento', sourceType: 'person', targetType: 'location' }
        ];
        
        const lowerText = text.toLowerCase();
        
        // Para cada par de entidades, buscar relaciones
        for (let i = 0; i < entities.length; i++) {
            for (let j = 0; j < entities.length; j++) {
                if (i === j) continue;
                
                const source = entities[i];
                const target = entities[j];
                
                // Para cada patrón que coincida con los tipos de entidad
                relationPatterns.forEach(pattern => {
                    if (source.type === pattern.sourceType && target.type === pattern.targetType) {
                        // Buscar el patrón verbal entre las dos entidades
                        const sourceNameLower = source.name.toLowerCase();
                        const targetNameLower = target.name.toLowerCase();
                        
                        // Verificar si el patrón aparece entre los nombres
                        const sourceIndex = lowerText.indexOf(sourceNameLower);
                        const targetIndex = lowerText.indexOf(targetNameLower);
                        
                        if (sourceIndex >= 0 && targetIndex >= 0) {
                            // Determinar el orden (quién está primero)
                            const firstIndex = Math.min(sourceIndex, targetIndex);
                            const secondIndex = Math.max(sourceIndex, targetIndex);
                            const middleText = lowerText.substring(firstIndex, secondIndex);
                            
                            if (pattern.verb.test(middleText)) {
                                // Si el patrón está en medio, hay una relación
                                relations.push({
                                    sourceEntity: source.name,
                                    targetEntity: target.name,
                                    sourceType: source.type,
                                    targetType: target.type,
                                    relationType: pattern.relation,
                                    confidence: 0.75
                                });
                            }
                        }
                    }
                });
                
                // Heurística: si dos entidades aparecen muy cerca una de otra, 
                // es probable que estén relacionadas
                const sourcePos = lowerText.indexOf(source.name.toLowerCase());
                const targetPos = lowerText.indexOf(target.name.toLowerCase());
                
                if (sourcePos >= 0 && targetPos >= 0) {
                    const distance = Math.abs(sourcePos - targetPos);
                    
                    // Si están a menos de 50 caracteres, asumir co-ocurrencia
                    if (distance < 50) {
                        relations.push({
                            sourceEntity: source.name,
                            targetEntity: target.name,
                            sourceType: source.type,
                            targetType: target.type,
                            relationType: 'co-ocurrencia',
                            confidence: 0.6
                        });
                    }
                }
            }
        }
        
        // Eliminar duplicados y ordenar por confianza
        const uniqueRelations = [];
        const seenKeys = new Set();
        
        relations.forEach(rel => {
            const key = `${rel.sourceEntity}:${rel.targetEntity}:${rel.relationType}`;
            
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueRelations.push(rel);
            }
        });
        
        return uniqueRelations.sort((a, b) => b.confidence - a.confidence);
    } catch (error) {
        console.error('EntityExtractor: Error al extraer relaciones:', error);
        return [];
    }
}

// Inicializar el módulo
init();

module.exports = {
    extractEntities,
    saveEntity,
    searchEntities,
    extractEntityRelations
};